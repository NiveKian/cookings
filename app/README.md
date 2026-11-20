# `app/` — Cookings

Cliente React + Vite + TailwindCSS, com **arquitetura hexagonal**, e um pequeno backend em **Bun + Hono** que orquestra a conversa com a IA e a execução das tools MCP. Ver `GUIA_LLM.md` (raiz do projeto) para o contexto arquitetural completo.

## Duas Abas

- **Informações**: consome os `service_*` (pasta `services/`) **diretamente do navegador**, via `fetch` — sem passar por IA ou MCP. Lista cursos, alunos e receitas.
- **Chatbot**: envia a mensagem do usuário para `POST /api/chat` (backend deste próprio app). O orquestrador consulta o cache semântico, chama a LLM com tools MCP, passa a resposta por um juiz (segunda LLM) e devolve `{ reply, toolCallsExecuted, evidencias, judge, cache }`. A UI mostra selo de cache e o veredito do juiz em `<details>` (texto puro, sem markdown).

## Por Que Há um Backend Aqui

O `app` é uma SPA, mas chamadas a LLMs (com chave de API) e a orquestração de tool-calling contra os servidores MCP **precisam** rodar no servidor — nunca no navegador (a chave vazaria, e MCP via `streamable-http` server-to-server é o padrão já definido no `GUIA_LLM.md`). Por isso, além do front, este projeto tem um `server.ts` (Bun + Hono) que:
1. Serve o build estático do Vite (`dist/`) em produção.
2. Expõe `POST /api/chat` (IA + MCP + juiz + cache), `GET /api/health` e `GET /api/metrics`.

## Arquitetura Hexagonal

```
src/
├── domain/
│   ├── entities.ts          # Curso, Aluno, Matricula, Receita, ChatMessage...
│   └── ports/
│       ├── LLMPort.ts        # contrato que Gemini/Claude/GPT/Mock implementam
│       ├── ToolsPort.ts      # contrato de descoberta/execução de tools MCP
│       └── ServicePorts.ts   # contrato de leitura dos services (aba Informações)
│
├── application/
│   ├── chat/sendChatMessage.ts   # loop de tool-calling
│   ├── chat/answerQuestion.ts    # cache → LLM → juiz → grava/invalida
│   └── info/infoQueries.ts       # casos de uso finos da aba Informações
│
├── infrastructure/
│   ├── llm/
│   │   ├── GeminiAdapter.ts   ┐
│   │   ├── ClaudeAdapter.ts   ├─ implementam LLMPort
│   │   ├── GptAdapter.ts      ┤  (fetch direto às APIs, sem SDK pesado)
│   │   ├── MockAdapter.ts     ┘  (bônus: testes offline, ver abaixo)
│   │   └── llmFactory.ts      # único ponto de troca de provedor (LLM_PROVIDER no .env)
│   ├── mcp/McpToolsAdapter.ts # implementa ToolsPort, conecta aos 3 servidores MCP
│   ├── judge/                    # MockJudgeAdapter + LLMJudgeAdapter
│   ├── embeddings/ + cache/      # EmbeddingPort + SqliteSemanticCache
│   ├── metrics/                  # GET /api/metrics (memória) + log JSONL
│   └── http/ServicesHttpAdapter.ts # implementa ServicePorts, fetch do navegador
│
└── ui/
    ├── App.tsx            # abas
    ├── InfoTab/InfoTab.tsx
    └── ChatTab/ChatTab.tsx
```

Trocar de provedor de IA é mudar **uma linha** no `.env` (`LLM_PROVIDER=gemini|claude|gpt`) — nenhum código muda, porque `application/chat/sendChatMessage.ts` só conhece a interface `LLMPort`, nunca uma implementação concreta.

## Como Rodar (Docker — recomendado)

Pressupõe que a rede `cookings-network` já existe e que `services/` e `mcp/` já estão no ar.

```bash
cp .env.example .env
# edite .env: preencha GEMINI_API_KEY (ou troque LLM_PROVIDER e a chave do provedor escolhido)

docker compose up -d --build
```

Acesse `http://localhost:3000`.

## Como Rodar (sem Docker, para desenvolvimento)

Requer Bun instalado.

```bash
bun install
cp .env.example .env
# edite .env (ao menos LLM_PROVIDER + a chave correspondente, ou use LLM_PROVIDER=mock — ver abaixo)

bun run dev
```

Isso sobe **dois processos ao mesmo tempo** (via `concurrently`): o Vite (porta `5173`, com hot reload) e o backend (porta `3000`), com o Vite fazendo proxy de `/api/*` para o backend. Acesse `http://localhost:5173`.

## Testando Sem Chave de API Real (`LLM_PROVIDER=mock`)

Como não é possível testar Gemini/Claude/GPT de verdade sem uma chave paga, este projeto inclui um 4º adapter, **`MockAdapter`**, só para desenvolvimento/demonstração (não é um dos 3 provedores exigidos pelo trabalho — é um bônus de testabilidade). Com `LLM_PROVIDER=mock` no `.env`, nenhuma chave é necessária, e o backend ainda executa tools **reais** nos servidores MCP reais.

Protocolo do mock: mande uma mensagem no formato `TOOL:<nome_da_tool>:<json_de_argumentos>` no chat (ou via `curl`) para forçar a chamada de uma tool de verdade:

```bash
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"TOOL:listar_cursos:{\"categoria\":\"Massas\"}"}]}'
```

Qualquer outra mensagem recebe apenas um eco de texto (sem chamar tools).

## Juiz, cache, métricas e avaliação

- **Juiz** (`JUDGE_ENABLED=true`, `JUDGE_PROVIDER`): outra LLM (ou `mock`) avalia fidelidade, coerência, segurança, relevância e clareza. Fail-open na entrega, fail-closed no cache. `ollama` usa `qwen2.5:1.5b` local (sem chave; não é o `LLM_PROVIDER`).
- **Cache semântico** (`CACHE_ENABLED=true`, `bun:sqlite`): só pergunta standalone, sem novidade (`invente`/`outra`/`diferente`/`surpreenda`), com juiz aprovando. HIT devolve a resposta sem chamar a LLM principal.
- **`GET /api/metrics`**: contadores em memória do processo (hits, misses, LLM evitadas, vereditos, média das notas, latência com/sem cache). Zera ao reiniciar. Sem chat ainda, tudo 0.
- **Log JSONL** (`EVAL_LOG_PATH`): uma linha por resposta. Vazio no `.env.example` = desligado. Falha de disco não derruba o chat.
- **Avaliação offline** (sem chave, sem Docker):

```bash
bun test
bun run scripts/eval.ts
```

`scripts/eval.ts` roda `scripts/eval-questions.json` (20 perguntas) com mocks + sqlite temporário e imprime taxa de HIT, notas médias e chamadas ao LLM.

Vars novas: ver `.env.example` (`CACHE_*`, `EMBEDDING_*`, `JUDGE_*`, `EVAL_LOG_PATH`).

## Estrutura

```
app/
├── docker-compose.yml
├── Dockerfile
├── server.ts               # backend Bun/Hono: /api/chat, /api/health, /api/metrics, serve dist/
├── scripts/eval.ts         # avaliação offline (mocks)
├── scripts/eval-questions.json
├── src/                     # ver árvore hexagonal acima
├── index.html, vite.config.ts, tailwind.config.js, postcss.config.js
└── .env.example
```
