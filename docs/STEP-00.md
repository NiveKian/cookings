# STEP 0 — Pré-requisitos (fallback de modelos + `.gitattributes`)

Corrige a regressão encontrada no repositório: o commit `058dedc` sobrescreveu o fallback de modelos (`aeceafe`), mas o `.env.example` continuou com listas (`CLAUDE_MODEL=a,b`). Resultado: a string inteira com vírgula era enviada como **um** nome de modelo, e a API respondia 404. Também elimina o ruído de CRLF no git.

## Arquivos

| Ação | Arquivo |
|---|---|
| Substituir inteiro | `app/src/domain/ports/LLMPort.ts` |
| **Novo** | `app/src/infrastructure/llm/modelList.ts` |
| Substituir inteiro | `app/src/infrastructure/llm/ClaudeAdapter.ts` |
| Substituir inteiro | `app/src/infrastructure/llm/GptAdapter.ts` |
| **Novo** | `.gitattributes` (raiz do repositório) |

`llmFactory.ts`, `GeminiAdapter.ts` e `.env.example` **não mudam**: a factory já passa `process.env.CLAUDE_MODEL` / `OPENAI_MODEL` como string, e o construtor agora aceita a lista separada por vírgula. O Gemini continua com modelo único (`GEMINI_MODEL`).

## Comportamento

- `CLAUDE_MODEL` / `OPENAI_MODEL` aceitam vários modelos separados por vírgula, tentados em ordem. Espaços e itens vazios são ignorados. Vazio ou ausente usa o padrão do adapter (`claude-sonnet-4-5` / `gpt-4o-mini`).
- Só **HTTP 404** (modelo inexistente, aposentado ou sem acesso) passa para o próximo modelo.
- **Não** passam para o próximo modelo: 401/403 (autenticação), 400 (payload), nem 429/503/529. Esses últimos continuam com retry e backoff no **mesmo** modelo; se os retries esgotarem, o erro é propagado.
- Se todos os modelos da lista derem 404, o erro lista os modelos tentados.
- Cada troca aparece no log do app: `[claude] Modelo "x" indisponível (404): ... Tentando o próximo modelo da lista...`

---

## 1. `app/src/domain/ports/LLMPort.ts` (substituir o arquivo inteiro)

```typescript
// Porta (interface) que qualquer provedor de LLM deve implementar.
// É esta porta que torna trivial trocar Gemini <-> Claude <-> GPT — ver
// infrastructure/llm/llmFactory.ts.

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (mesmo formato usado pelo protocolo MCP). */
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  /** ID gerado pelo provedor, usado para correlacionar o resultado da tool de volta a essa chamada. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Exclusivo do Gemini 3.x: assinatura opaca do estado de raciocínio do
   * modelo, que precisa ser devolvida sem alteração na próxima chamada.
   * Outros provedores (Claude, GPT) ignoram este campo.
   */
  thoughtSignature?: string;
}

/**
 * Lançado por um adapter quando o provedor informa que o modelo pedido não
 * existe, foi aposentado ou não está disponível para a chave usada (ex.:
 * HTTP 404). Permite ao adapter tentar o próximo modelo da lista
 * configurada no .env. NÃO deve ser usado para erros transitórios
 * (429/503/529 — esses já têm retry próprio) nem para erros de
 * autenticação (401/403), que nunca se resolvem trocando de modelo.
 */
export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

export type LLMTurnResult =
  | { type: "text"; text: string }
  | { type: "tool_calls"; toolCalls: LLMToolCall[] };

/**
 * Representa um "turno" da conversa em um formato genérico, independente
 * de provedor. O adapter de cada LLM é responsável por converter esta
 * lista para o formato nativo da sua API a cada chamada.
 */
export type ConversationTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "assistant_tool_calls"; toolCalls: LLMToolCall[] }
  | { role: "tool_results"; results: Array<{ toolCallId: string; name: string; result: unknown }> };

export interface LLMPort {
  /** Nome do provedor, só para logs/debug (ex: "gemini", "claude", "gpt", "mock"). */
  readonly providerName: string;

  converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult>;
}
```

## 2. `app/src/infrastructure/llm/modelList.ts` (arquivo novo)

```typescript
// Interpreta a lista de modelos vinda do .env (ex.: CLAUDE_MODEL, OPENAI_MODEL).
// Formato: nomes separados por vírgula, tentados em ordem — o primeiro é o
// preferido, os seguintes são reservas caso o anterior tenha sido
// aposentado/indisponível. Espaços e itens vazios são ignorados. Se a
// variável estiver ausente ou vazia, usa o modelo padrão do adapter.
export function parseModelList(raw: string | undefined, padrao: string): string[] {
  const lista = (raw ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  return lista.length > 0 ? lista : [padrao];
}
```

## 3. `app/src/infrastructure/llm/ClaudeAdapter.ts` (substituir o arquivo inteiro)

```typescript
import type {
  ConversationTurn,
  LLMPort,
  LLMToolCall,
  LLMTurnResult,
  ToolDefinition,
} from "../../domain/ports/LLMPort";
import { ModelUnavailableError } from "../../domain/ports/LLMPort";
import { parseModelList } from "./modelList";

// Adapter para a Anthropic Messages API (Claude), via fetch direto.
// Implementa LLMPort — para trocar de provedor, ver
// infrastructure/llm/llmFactory.ts.

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface ClaudeMessage {
  role: "user" | "assistant";
  content: ClaudeContentBlock[];
}

// Códigos transitórios: vale tentar de novo. Qualquer outro (400, 401,
// 404...) é erro definitivo — não adianta repetir.
const RETRYABLE_STATUS = [429, 503, 529]; // 529 = "overloaded_error" específico da Anthropic
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function turnsToClaudeMessages(turns: ConversationTurn[]): ClaudeMessage[] {
  const messages: ClaudeMessage[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: [{ type: "text", text: turn.content }] });
    } else if (turn.role === "assistant") {
      messages.push({ role: "assistant", content: [{ type: "text", text: turn.content }] });
    } else if (turn.role === "assistant_tool_calls") {
      messages.push({
        role: "assistant",
        content: turn.toolCalls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        })),
      });
    } else if (turn.role === "tool_results") {
      messages.push({
        role: "user",
        content: turn.results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.toolCallId,
          content: JSON.stringify(r.result),
        })),
      });
    }
  }

  return messages;
}

const MODELO_PADRAO = "claude-sonnet-4-5";

export class ClaudeAdapter implements LLMPort {
  readonly providerName = "claude";
  private readonly models: string[];

  /**
   * @param models um modelo, ou vários separados por vírgula (ex.:
   * "modelo-principal,modelo-reserva"). Os reservas só são usados se o
   * anterior estiver indisponível (404) — ver converse().
   */
  constructor(private readonly apiKey: string, models?: string) {
    this.models = parseModelList(models, MODELO_PADRAO);
  }

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    let ultimoErro: ModelUnavailableError | null = null;

    for (const model of this.models) {
      try {
        return await this.callModel(model, params);
      } catch (err) {
        if (err instanceof ModelUnavailableError) {
          console.warn(`[claude] ${err.message} Tentando o próximo modelo da lista...`);
          ultimoErro = err;
          continue;
        }
        // Qualquer outro erro (auth, rate limit esgotado, rede, payload)
        // não se resolve trocando de modelo — propaga.
        throw err;
      }
    }

    throw new Error(
      `Claude API: nenhum dos modelos configurados está disponível (${this.models.join(", ")}). ` +
        `Último erro: ${ultimoErro?.message ?? "desconhecido"}`
    );
  }

  private async callModel(
    model: string,
    params: { systemPrompt: string; turns: ConversationTurn[]; tools: ToolDefinition[] }
  ): Promise<LLMTurnResult> {
    const requestBody = JSON.stringify({
      model,
      max_tokens: 1024,
      system: params.systemPrompt,
      messages: turnsToClaudeMessages(params.turns),
      tools: params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    });

    let resp: Response | null = null;

    for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: requestBody,
      });

      if (resp.ok) break;

      const podeTentarDeNovo = RETRYABLE_STATUS.includes(resp.status) && tentativa < MAX_RETRIES;
      if (!podeTentarDeNovo) break;

      const esperaMs = 500 * 2 ** tentativa + Math.random() * 250;
      console.warn(
        `[claude] ${resp.status} (tentativa ${tentativa + 1}/${MAX_RETRIES + 1}), aguardando ${Math.round(esperaMs)}ms...`
      );
      await sleep(esperaMs);
    }

    if (!resp) {
      throw new Error("Claude API: nenhuma resposta obtida após as tentativas.");
    }

    // 404 = modelo inexistente/aposentado (not_found_error): dá para tentar
    // outro modelo da lista.
    if (resp.status === 404) {
      const detalhe = await resp.text();
      throw new ModelUnavailableError(`Modelo "${model}" indisponível (404): ${detalhe}`);
    }

    if (!resp.ok) {
      const detalhe = await resp.text();
      throw new Error(`Claude API respondeu ${resp.status}: ${detalhe}`);
    }

    const data = await resp.json();
    const blocks: ClaudeContentBlock[] = data.content ?? [];

    const toolCalls: LLMToolCall[] = blocks
      .filter((b): b is Extract<ClaudeContentBlock, { type: "tool_use" }> => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, arguments: b.input }));

    if (toolCalls.length > 0) {
      return { type: "tool_calls", toolCalls };
    }

    const texto = blocks
      .filter((b): b is Extract<ClaudeContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return { type: "text", text: texto || "(sem resposta)" };
  }
}
```

## 4. `app/src/infrastructure/llm/GptAdapter.ts` (substituir o arquivo inteiro)

```typescript
import type {
  ConversationTurn,
  LLMPort,
  LLMToolCall,
  LLMTurnResult,
  ToolDefinition,
} from "../../domain/ports/LLMPort";
import { ModelUnavailableError } from "../../domain/ports/LLMPort";
import { parseModelList } from "./modelList";

// Adapter para a OpenAI Chat Completions API (GPT), via fetch direto.
// Implementa LLMPort — para trocar de provedor, ver
// infrastructure/llm/llmFactory.ts.

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

function turnsToOpenAIMessages(systemPrompt: string, turns: ConversationTurn[]): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [{ role: "system", content: systemPrompt }];

  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
    } else if (turn.role === "assistant") {
      messages.push({ role: "assistant", content: turn.content });
    } else if (turn.role === "assistant_tool_calls") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: turn.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else if (turn.role === "tool_results") {
      for (const r of turn.results) {
        messages.push({ role: "tool", tool_call_id: r.toolCallId, content: JSON.stringify(r.result) });
      }
    }
  }

  return messages;
}

// Códigos transitórios: vale tentar de novo. Qualquer outro (400, 401,
// 404...) é erro definitivo — não adianta repetir.
const RETRYABLE_STATUS = [429, 503];
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MODELO_PADRAO = "gpt-4o-mini";

export class GptAdapter implements LLMPort {
  readonly providerName = "gpt";
  private readonly models: string[];

  /**
   * @param models um modelo, ou vários separados por vírgula (ex.:
   * "modelo-principal,modelo-reserva"). Os reservas só são usados se o
   * anterior estiver indisponível (404) — ver converse().
   */
  constructor(private readonly apiKey: string, models?: string) {
    this.models = parseModelList(models, MODELO_PADRAO);
  }

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    let ultimoErro: ModelUnavailableError | null = null;

    for (const model of this.models) {
      try {
        return await this.callModel(model, params);
      } catch (err) {
        if (err instanceof ModelUnavailableError) {
          console.warn(`[gpt] ${err.message} Tentando o próximo modelo da lista...`);
          ultimoErro = err;
          continue;
        }
        // Qualquer outro erro (auth, rate limit esgotado, rede, payload)
        // não se resolve trocando de modelo — propaga.
        throw err;
      }
    }

    throw new Error(
      `OpenAI API: nenhum dos modelos configurados está disponível (${this.models.join(", ")}). ` +
        `Último erro: ${ultimoErro?.message ?? "desconhecido"}`
    );
  }

  private async callModel(
    model: string,
    params: { systemPrompt: string; turns: ConversationTurn[]; tools: ToolDefinition[] }
  ): Promise<LLMTurnResult> {
    const requestBody = JSON.stringify({
      model,
      messages: turnsToOpenAIMessages(params.systemPrompt, params.turns),
      tools: params.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
    });

    let resp: Response | null = null;

    for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: requestBody,
      });

      if (resp.ok) break;

      const podeTentarDeNovo = RETRYABLE_STATUS.includes(resp.status) && tentativa < MAX_RETRIES;
      if (!podeTentarDeNovo) break;

      const esperaMs = 500 * 2 ** tentativa + Math.random() * 250;
      console.warn(
        `[gpt] ${resp.status} (tentativa ${tentativa + 1}/${MAX_RETRIES + 1}), aguardando ${Math.round(esperaMs)}ms...`
      );
      await sleep(esperaMs);
    }

    if (!resp) {
      throw new Error("OpenAI API: nenhuma resposta obtida após as tentativas.");
    }

    // 404 (model_not_found) = modelo inexistente, aposentado ou sem acesso
    // para esta chave: dá para tentar outro modelo da lista.
    if (resp.status === 404) {
      const detalhe = await resp.text();
      throw new ModelUnavailableError(`Modelo "${model}" indisponível (404): ${detalhe}`);
    }

    if (!resp.ok) {
      const detalhe = await resp.text();
      throw new Error(`OpenAI API respondeu ${resp.status}: ${detalhe}`);
    }

    const data = await resp.json();
    const message = data?.choices?.[0]?.message ?? {};

    const toolCalls: LLMToolCall[] = (message.tool_calls ?? []).map((tc: OpenAIToolCall) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
    }));

    if (toolCalls.length > 0) {
      return { type: "tool_calls", toolCalls };
    }

    return { type: "text", text: message.content || "(sem resposta)" };
  }
}
```

## 5. `.gitattributes` (arquivo novo, na raiz do repositório, ao lado de `.gitignore`)

```gitattributes
* text=auto eol=lf
```

Depois de criar o arquivo, rode na raiz do repositório:

```bash
git add --renormalize .
git status
```

O `git status` deve listar só as mudanças reais de conteúdo (os arquivos deste step). Os arquivos que apareciam como modificados só por causa do CRLF (`.gitignore`, `ChatHistoryStorage.ts`) deixam de aparecer. Os arquivos do seu working tree no Windows passam a ser gravados com LF.

---

## Como aplicar no Docker

```bash
cd app
docker compose up -d --build
```

Nenhuma mudança em `services/` nem em `mcp/`, e nenhum `.env` novo.

## Validação

**Validado (no meu ambiente):**
- `bun run typecheck` e `bun run build` limpos.
- Teste com `fetch` substituído por um servidor falso, para Claude e GPT, todos passando:
  - 404 no 1º modelo usa o 2º;
  - todos 404 gera erro listando os modelos;
  - 401 não troca de modelo;
  - 503 faz retry no mesmo modelo;
  - 503 esgotado não troca de modelo;
  - string vazia e `undefined` usam o padrão;
  - modelo único continua funcionando.
- `.gitattributes` testado num clone descartável do seu repositório: o ruído de CRLF desapareceu e sobraram só as mudanças reais.

**Não validado:**
- Chamadas reais a Claude e GPT (sem chaves aqui). A suposição "404 = modelo indisponível" segue o comportamento documentado dos dois provedores e deve ser confirmada com uma chave real: ponha um modelo inválido primeiro na lista e um válido depois, e confira o log.
- Build da imagem Docker.

## Observação sobre os IDs de modelo

O `.env.example` lista `claude-sonnet-4-6` e `claude-sonnet-4-5-20250929` (Claude) e `gpt-4o-mini`/`gpt-4o` (GPT). Os IDs de modelo mudam com frequência. Confira as páginas oficiais antes de usar (a Anthropic lista, por exemplo, `claude-sonnet-5-5` entre os modelos atuais). Com o fallback funcionando, você pode colocar o mais novo primeiro e o antigo como reserva.
