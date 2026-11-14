# GUIA DE EVOLUÇÃO — Cookings Especialista (para LLMs implementadoras)

> Leia este arquivo inteiro antes de escrever qualquer código. Ele contém (1) um snapshot enxuto do que já existe, (2) as decisões de design já tomadas e (3) as fases de implementação com critérios de aceite. O fallback de modelos (Step 0) e o schema/seed de alérgenos, origem e substituições (Step 1) já estão no repositório. O restante deste documento ainda é especificação: services, MCP e app não expõem esses campos.

---

## 0. Regras de trabalho (obrigatórias)

1. **Leia o código existente antes de alterar.** Pastas: `services/`, `mcp/`, `app/` (ver seção 1). Não presuma nomes de parâmetros de tools MCP; abra os `server.py`.
2. **Respeite as convenções do projeto** (seção 1.3). Comentários e docs em português.
3. **Não declare nada como "testado" sem ter executado.** Ao final, entregue o relatório da seção 7, separando o que foi validado do que não foi.
4. **Valide sempre:** `bun run typecheck` e `bun run build` no `app/`; `curl` nos services; `test_client.py` nos servidores MCP.
5. **Informação que muda rápido (nomes de modelos, endpoints de embeddings, preços) deve ser conferida na documentação oficial do provedor no momento da implementação.** Não hardcode de memória.
6. **Entregue mudanças como arquivos completos ou diffs aplicáveis.** Só gere zip se o desenvolvedor pedir.
7. **Se uma decisão deste guia se mostrar inviável, pare e reporte** em vez de decidir silenciosamente.
8. **Ao escrever código, delegue a implementação para subagentes** usando os modelos Opus ou Sonnet (via Agent com `model: "opus"` ou `model: "sonnet"`). Reserve o modelo principal para planejamento, revisão e integração dos resultados.

---

## 1. Snapshot do contexto (só o que importa agora)

### 1.1 Objetivo
Trabalho da disciplina de **Sistema Especialista para Web**: um chatbot especialista que será registrado como capítulo do livro "Sistemas Especialistas Integrados a Grandes Modelos de Inteligência Artificial, Uma Coleção de Exemplos Práticos". O trabalho original exige ≥3 serviços web, um cliente que consuma todos e acesso por IA via MCP (isso já está pronto).

**Descrição oficial do especialista (evolução):** é um especialista capaz de responder a perguntas sobre a área de culinária e cursos de culinária online, possuindo um cache semântico para perguntas repetidas, capacidade de executar ferramentas MCP de consulta e geração de receitas inéditas, e julgamento automatizado de pares de perguntas + respostas por uma segunda LLM.

### 1.2 Estado atual

| Subprojeto | Stack | Papel | Portas |
|---|---|---|---|
| `services/` | Bun + Hono + Drizzle + Zod + PostgreSQL único (3 schemas: `cursos`, `matriculas`, `receitas`) | APIs REST, fonte da verdade | 3001 cursos, 3002 matrículas, 3003 receitas |
| `mcp/` | Python + uv + FastMCP (`streamable-http`) + httpx | Tradutor MCP → HTTP, 1 servidor por domínio, 17 tools | interna 8000; host 8001/8002/8003 |
| `app/` | React + Vite + Tailwind + backend Bun/Hono (`server.ts`), arquitetura hexagonal | Aba Informações (REST direto) + aba Chatbot (`POST /api/chat`) | 3000 (prod), 5173 (vite dev) |

- Rede Docker externa `cookings-network`; cada subprojeto tem seu próprio `docker-compose.yml`.
- **Tools MCP existentes (17):** `mcp_cursos`: listar_cursos, obter_curso, listar_aulas_do_curso, criar_curso, criar_aula. `mcp_matriculas`: listar_alunos, obter_aluno, cadastrar_aluno, listar_matriculas, obter_matricula, matricular_aluno, atualizar_progresso_matricula. `mcp_receitas`: listar_receitas, obter_receita, criar_receita, listar_ingredientes, adicionar_ingrediente_a_receita.
- **Fluxo do chat hoje:** `ChatTab` → `POST /api/chat` (histórico completo, só role/content) → `sendChatMessage` (loop de tool-calling, `MAX_TOOL_ITERATIONS = 5`) → `LLMPort.converse` → `McpToolsAdapter` → servidores MCP → services → Postgres. Retorna `{ reply, toolCallsExecuted }`.
- **Ports existentes** (`app/src/domain/ports/`): `LLMPort`, `ToolsPort`, `ServicePorts`. Adapters LLM em `app/src/infrastructure/llm/`: Gemini, Claude, GPT, Mock + `llmFactory.ts` (`LLM_PROVIDER`).
- **Estado do chat no front:** vive em `App.tsx` (sobrevive à troca de aba); persistência opcional em `localStorage` com consentimento (`ChatHistoryStorage.ts`).
- **Dados de seed** (`services/db/init/001_seed.sql`, roda só na 1ª inicialização do volume): IDs fixos por prefixo (`1000…` cursos, `2000…` aulas, `3000…` alunos, `4000…` matrículas, `5000…` ingredientes, `6000…` receitas, `7000…` substituições). Grupo `0000` = amostra original; grupo `0001` = catálogo ampliado. Totais: 103 cursos, 107 aulas, 103 alunos, 104 matrículas, 112 ingredientes, 103 receitas, 416 vínculos, 105 substituições. **Mudanças de schema ou do seed exigem `docker compose down -v` ou migração manual.**

### 1.3 Convenções obrigatórias
- `services/` e `mcp/`: **simples, poucos arquivos** (service: `index.ts`, `db.ts`, `schema.ts`, `routes.ts`; MCP: `server.py`). Sem camadas extras, sem autenticação.
- `app/`: **hexagonal rigoroso** — domínio (entidades + portas) → aplicação (casos de uso) → infraestrutura (adapters) → UI. A aplicação só conhece portas.
- Cada `service_*` só acessa o próprio schema; **sem FOREIGN KEY entre schemas** (referências cruzadas são UUID simples).
- Variáveis de ambiente só via `.env.example` (o desenvolvedor preenche o `.env`). Nunca preencher chaves.
- Respostas de erro dos services: `{ "error": "...", "details": [...] }`. JSON em camelCase; campos numéricos de banco (`preco`, `quantidade`) chegam como **string**.
- MCP: transporte `streamable-http`, nunca `stdio`. Erros de tool retornam `{ "erro": true, "status": ..., "detalhe": ... }`.
- Trocar de provedor de LLM = só `.env`; nenhuma regra de provedor pode vazar para a camada de aplicação.

### 1.4 Armadilhas já resolvidas (não regredir)
- **Gemini:** modelo padrão é o alias `gemini-flash-latest` (o `gemini-2.0-flash` foi desligado); `functionCall`/`functionResponse` levam `id`; `functionResponse.response` **precisa ser objeto** (`wrapForGemini` envelopa arrays/primitivos); `thoughtSignature` deve ser ecoado sem alteração (só a 1ª chamada paralela traz); retry com backoff em 429/503. Claude também faz retry em 529.
- **`McpToolsAdapter.callTool`:** tools que retornam lista chegam como **vários blocos de conteúdo**; cada bloco é parseado individualmente. **Quirk conhecido:** lista vazia vira `null` e lista de 1 item vira objeto (indistinguível de resultado único). Normalize isso se algum componente novo depender de "é lista?".
- `if (!resp) throw` após loops de retry (evita `resp!` espalhado).
- Dentro de containers, MCP é acessado por hostname (`http://mcp_cursos:8000/mcp`); fora do Docker, por `localhost:8001..8003`. `server.ts` já alterna: `APP_ENV=local` (script `dev:server`) lê `MCP_*_URL_DEV`; sem isso, lê `MCP_*_URL`.
- Frontend renderiza texto puro (`whitespace-pre-wrap`), sem markdown.

### 1.5 Limitações conhecidas
- O front envia só texto de role/content a cada mensagem; estado interno de tools/assinaturas **não** persiste entre mensagens do usuário. O `/api/chat` recebe também a saudação inicial do assistente como 1ª mensagem — **ao contar "perguntas do usuário", conte só `role === "user"`**.
- Lista de modelos de fallback (só HTTP 404) está em `ClaudeAdapter` / `GptAdapter` (`parseModelList`). Gemini continua com modelo único.

### 1.6 O que foi e não foi validado até aqui
- **Validado:** services (curl, Postgres real), MCP (cliente MCP real), app (typecheck, build, loop completo com `MockAdapter`, Gemini real em parte — os erros de 404/400/503 vieram de chamadas reais).
- **Não validado:** Claude e GPT com chave real; build de imagens Docker e `docker compose` (nunca houve Docker no ambiente de desenvolvimento); renderização em navegador real.

---

## 2. Visão-alvo: fluxo de uma pergunta

```
usuário → /api/chat
  1. Cache semântico: pergunta é "standalone" e elegível? → busca por similaridade
       ├─ HIT (acima do limiar, entrada aprovada, não expirada) → devolve resposta do cache  [sem LLM principal, sem juiz]
       └─ MISS ↓
  2. LLM principal + tools MCP (loop existente), coletando EVIDÊNCIAS (nome da tool, args, resultado)
  3. LLM juíza (outro provedor) avalia {pergunta, resposta, evidências}
       ├─ aprovar → entrega + (se elegível) grava no cache
       ├─ revisar → regenera com o feedback do juiz (máx. N vezes) → rejulga
       └─ reprovar/esgotou → resposta segura com aviso (nunca grava no cache)
  4. Resposta + metadados (cache, juiz, tools) → UI
```

---

## 3. Decisões de design (justificativas — contestar só com motivo forte)

1. **Ordem de implementação: dados/tools → geração → juiz → cache → observabilidade.** O cache só guarda respostas aprovadas, então o juiz vem antes dele.
2. **Armazenamento do cache: `bun:sqlite` (embutido no Bun) em arquivo dentro do `app/`, com volume Docker**, similaridade por cosseno calculada em JS. Escala pequena, zero infraestrutura nova. *Alternativa rejeitada:* pgvector — exigiria trocar a imagem do Postgres, alterar o seed e acoplar o `app` ao banco (hoje ele só fala com os services). Confirmar que `bun:sqlite` está disponível na imagem `oven/bun:1` usada no Dockerfile.
3. **Cache só para perguntas "standalone"** (exatamente 1 mensagem `user` no histórico). Follow-ups ("e o segundo?") dependem de contexto e dariam falsos HITs.
4. **Cache não é usado/gravado quando:** a resposta envolveu tools **mutáveis** (cadastrar, matricular, atualizar progresso, criar/salvar); o pedido é de **novidade** (inventar/outra/diferente/surpreenda) — senão o usuário recebe sempre a mesma receita; o juiz não aprovou; o juiz estava indisponível.
5. **Invalidação:** cada entrada guarda `dominios` (derivados das tools usadas: cursos/matriculas/receitas), `criadoEm`, `modeloEmbedding` e TTL. Qualquer tool mutável executada apaga entradas dos domínios afetados. Entradas com modelo de embedding diferente do atual são ignoradas.
6. **Embeddings são independentes do `LLM_PROVIDER`** (porta própria `EmbeddingPort`). Anthropic, até onde se sabe, não oferece endpoint de embeddings próprio — **verifique na documentação**; por isso os adapters previstos são Gemini, OpenAI e um Mock determinístico.
7. **Juiz = outro provedor/modelo que o principal** (`JUDGE_PROVIDER` ≠ `LLM_PROVIDER`; a factory emite warning se forem iguais). Reusa `LLMPort` com `tools: []` e prompt que exige JSON; saída validada com Zod.
8. **Juiz vê as evidências das tools**, não só a resposta — sem isso não dá para checar fidelidade aos dados.
9. **Falha do juiz = fail-open para entrega, fail-closed para cache** (entrega a resposta, marca `judge.status = "unavailable"`, não grava).
10. **Receitas inventadas não são persistidas por padrão.** Persistir só quando o usuário pedir ("salve essa receita"), via tool dedicada.
11. **Tools "computacionais" (escalar porções, lista de compras) vivem no MCP**, compondo chamadas aos services existentes; services ganham apenas endpoints que exigem SQL (busca por ingrediente).

---

## 4. Fases de implementação

### Fase 1 — Fundação de dados e novas tools MCP

**1.1 Mudanças de schema** (editar `services/db/init/001_seed.sql` + `schema.ts` do `service_receitas`):
- `receitas.ingredientes`: nova coluna `alergenos TEXT[] NOT NULL DEFAULT '{}'`. Vocabulário fixo e minúsculo: `gluten`, `lactose`, `ovo`, `soja`, `amendoim`, `castanhas`, `peixe`, `crustaceos`. Preencher no seed para os 12 ingredientes existentes (ex.: farinha de trigo → gluten; ovos → ovo; manteiga e leite → lactose).
- `receitas.receitas`: `curso_id` passa a **nullable**; nova coluna `origem TEXT NOT NULL DEFAULT 'curso' CHECK (origem IN ('curso','ia'))`.
- (Should) nova tabela `receitas.substituicoes (id, ingrediente_id FK, substituto TEXT, observacao TEXT)` com algumas linhas de seed (ex.: manteiga, leite, ovos).
- Registrar no README de `services/` que o seed só roda em volume vazio (`docker compose down -v`).

**1.2 Mudanças no `service_receitas`:**
- `GET /receitas`: novos filtros `ingrediente` (nome; repetível ou separado por vírgula, comparação sem acento/caixa) e `modo=todos|qualquer` (padrão `qualquer`); incluir `origem` no retorno.
- `POST /receitas`: aceitar `cursoId` opcional e `origem`.
- `GET /ingredientes` e `GET /receitas/:id`: retornar `alergenos` por ingrediente. `POST /ingredientes`: aceitar `alergenos`.
- (Should) `GET /ingredientes/:id/substituicoes`.
- Manter o padrão de erro `{error, details}` e validação Zod.

**1.3 Novas tools MCP** (prioridade **M**ust / **S**hould):

| Servidor | Tool | Prio | Comportamento |
|---|---|---|---|
| `mcp_receitas` | `buscar_receitas_por_ingredientes(ingredientes, modo)` | M | Usa o novo filtro do service |
| `mcp_receitas` | `verificar_alergenos(receita_id, alergenos)` | M | Cruza alérgenos informados com os ingredientes da receita; retorna conflitos por ingrediente |
| `mcp_receitas` | `ajustar_porcoes(receita_id, porcoes)` | M | Escala quantidades proporcionalmente (computação no MCP; lembrar que `quantidade` vem como string) |
| `mcp_receitas` | `gerar_lista_de_compras(receita_ids, porcoes?)` | M | Agrega por ingrediente+unidade a partir de `obter_receita` |
| `mcp_receitas` | `salvar_receita_gerada(nome, modo_preparo, tempo_preparo_minutos, porcoes, ingredientes[], curso_id?, criar_ingredientes_ausentes=false)` | M | Cria receita com `origem='ia'`; resolve ingredientes **por nome** (sem acento/caixa); nomes não encontrados são **devolvidos** em `ingredientesNaoEncontrados` e só são criados no catálogo se o flag for verdadeiro |
| `mcp_receitas` | `sugerir_substituicoes(ingrediente_id)` | S | Lê a nova tabela |
| `mcp_cursos` | `buscar_cursos_por_texto(texto)` | S | Filtro local por título/descrição/categoria (padrão já usado em `listar_alunos`) |
| `mcp_matriculas` | `resumo_progresso_aluno(aluno_id)` | S | Agrega matrículas do aluno (total, ativas, concluídas, progresso médio) |

- Cada tool com docstring clara em português (a IA decide pelo texto), tratando erros no padrão `{erro: true, ...}`.
- Tools que alteram dados (`salvar_receita_gerada`, e as já existentes de cadastro/matrícula/progresso) devem ser **marcadas como mutáveis** em uma lista única no `app` (ver Fase 4) — ou expor essa informação via convenção de nome/metadata. Defina uma única fonte da verdade.

**Aceite da Fase 1:** `curl` nos novos endpoints com os dados de seed; `test_client.py` chamando cada nova tool (caso feliz + erro 404 + ingrediente não encontrado); `uv sync --frozen` ok; nenhuma tool antiga quebrada (reexecutar uma de cada servidor).

### Fase 2 — Geração de receitas inéditas

- Atualizar o `SYSTEM_PROMPT` em `application/chat/sendChatMessage.ts` (ou extraí-lo para arquivo próprio): permitir inventar receitas **ancoradas no catálogo** (consultar ingredientes/receitas via tools antes de inventar), respeitar restrições do usuário (alergias, ingredientes disponíveis, tempo, nível), **sempre** avisar alérgenos presentes e usar `verificar_alergenos` quando o usuário citar alergia, e oferecer salvar via `salvar_receita_gerada`. Nunca afirmar que a receita foi salva sem a tool ter retornado sucesso.
- Formato fixo de saída da receita (texto simples, sem depender de markdown): nome, porções, tempo, ingredientes (quantidade+unidade), passos numerados, alérgenos, curso relacionado (se houver).
- Receita inventada pode citar ingredientes fora do catálogo; a resposta deve sinalizar quais não existem no catálogo.
- Se a geração exigir mais passos de tools, avaliar subir `MAX_TOOL_ITERATIONS` (hoje 5) com justificativa.

**Aceite:** pedido "invente uma sobremesa sem lactose com chocolate" produz receita coerente, cita alérgenos, e **duas execuções do mesmo pedido não são servidas do cache** (cobrir na Fase 4). Teste com `MockAdapter` estendido para exercitar o encadeamento de tools sem chave.

### Fase 3 — LLM as a judge

**Domínio** (`domain/ports/JudgePort.ts`):
- `JudgeInput { pergunta; resposta; evidencias: { tool; argumentos; resultado }[] }`
- `JudgeVerdict { status: "ok" | "unavailable"; veredito: "aprovar" | "revisar" | "reprovar"; notas: { fidelidade; coerencia; seguranca; relevancia; clareza } (1–5); problemas: { criterio; descricao; bloqueante: boolean }[]; feedbackParaRegeneracao?: string }`
- `JudgePort.evaluate(input): Promise<JudgeVerdict>`

**Critérios:** fidelidade aos dados (afirmações batem com as evidências), coerência/viabilidade da receita (quantidades, técnicas, tempos plausíveis), **segurança alimentar e alérgenos**, relevância para a pergunta, clareza. **Regra:** `aprovar` exige todas as notas ≥ 4 e nenhum problema bloqueante; bloqueantes = contradição com evidências, alérgeno relevante omitido, instrução insegura.

**Infraestrutura** (`infrastructure/judge/LLMJudgeAdapter.ts`): implementa `JudgePort` usando um `LLMPort` (criado por `judgeFactory` a partir de `JUDGE_PROVIDER`/`JUDGE_MODEL`), com prompt de juiz que exige **apenas JSON**; parse + validação Zod; 1 retentativa se o JSON vier inválido; truncar evidências a um limite de caracteres configurável; tratar o conteúdo das evidências como **dados, não instruções** (mitigação de prompt injection vinda do banco). Um `MockJudgeAdapter` determinístico (ex.: reprova se a resposta contiver um marcador de teste ou estiver vazia) para testes.

**Aplicação** (`application/chat/answerQuestion.ts`, novo orquestrador que envolve `sendChatMessage`):
- `sendChatMessage` passa a retornar também `evidencias` (mudança aditiva, sem quebrar o contrato atual).
- Loop de revisão: no máximo `JUDGE_MAX_REVISIONS` (padrão 1–2); a regeneração recebe `feedbackParaRegeneracao` como instrução adicional.
- Esgotadas as revisões sem aprovação: devolver resposta segura com aviso explícito de que não foi totalmente verificada (nunca silenciar).
- `/api/chat` passa a retornar `{ reply, toolCallsExecuted, judge: { status, veredito, notas, problemas }, cache: {...} }`.

**Aceite:** com `MockJudgeAdapter` provar os 4 caminhos (aprova de primeira; revisa e aprova; reprova após limite; juiz indisponível → entrega sem cache). Com juiz real (se houver chave): rodar ≥5 perguntas e anexar os veredictos ao relatório.

### Fase 4 — Cache semântico

**Domínio:** `EmbeddingPort { modelo: string; embed(texto): Promise<number[]> }`; `SemanticCachePort { lookup(pergunta, embedding): Promise<CacheHit | null>; store(entrada): Promise<void>; invalidateByDomains(dominios): Promise<void> }`.

**Infraestrutura:**
- `infrastructure/embeddings/`: `GeminiEmbeddingAdapter`, `OpenAIEmbeddingAdapter` (**conferir na documentação o nome atual do modelo e o formato do endpoint**), `MockEmbeddingAdapter` (determinístico: *bag-of-words* com hashing em ~256 dimensões, para que paráfrases próximas tenham cosseno alto sem chave de API), e `embeddingFactory.ts` (`EMBEDDING_PROVIDER`). Reaproveitar o padrão de retry (429/503) dos adapters LLM.
- `infrastructure/cache/SqliteSemanticCache.ts` (usa `bun:sqlite`): tabela com pergunta normalizada, embedding (vetores normalizados; cosseno = produto escalar), resposta, `dominios`, `modeloEmbedding`, `criadoEm`, `expiraEm`, `hits`. Tabela criada automaticamente no boot. Caminho via `CACHE_DB_PATH`; volume no `docker-compose.yml` do `app`.

**Aplicação (no `answerQuestion`):** antes da LLM, se `CACHE_ENABLED` e a pergunta for standalone: normalizar → embed → `lookup` com `CACHE_SIMILARITY_THRESHOLD`. Depois da aprovação do juiz, gravar **somente se** elegível (decisões 3, 4 e 9). Mutação de dados → `invalidateByDomains`. Falha no cache ou no embedding **nunca derruba o chat** (loga e segue como MISS).

**Limiar:** começar em um valor alto (ex.: 0.90) e **calibrar com o conjunto de avaliação** — não inventar o número final; reportar o que foi medido.

**Aceite (com mocks):** pergunta repetida literal → HIT; paráfrase próxima → HIT; pergunta diferente → MISS; follow-up (2+ mensagens `user`) → nunca usa cache; pedido de novidade → nunca usa cache; após uma tool mutável, entradas do domínio somem; entrada expirada → MISS; trocar `EMBEDDING_*` não devolve entradas de modelo antigo.

### Fase 5 — Observabilidade, UI e avaliação

- **Metadados na UI (`ChatTab`):** selo discreto "resposta do cache (similaridade X)" e resultado do juiz (veredito + notas) em detalhe expansível; manter o fluxo e o estado do chat em `App.tsx` intactos. Se o histórico do `localStorage` guardar metadados, manter compatível com o formato antigo (`role`/`content`).
- **`GET /api/metrics`:** contadores em memória/SQLite — hits, misses, chamadas ao LLM principal evitadas, distribuição de vereditos, média de notas do juiz, latência média com e sem cache.
- **Log de avaliação** (JSONL): pergunta, resposta, evidências, veredito, fonte (cache/LLM). Útil para o capítulo.
- **Script de avaliação** (`app/scripts/eval.ts`): roda um conjunto fixo (~20 perguntas em `app/scripts/eval-questions.json`, incluindo paráfrases, follow-ups, pedidos de novidade e restrições alimentares) pelo orquestrador e imprime tabela com taxa de HIT, notas médias do juiz, nº de chamadas à LLM. **Todo número reportado deve vir de execução real — nunca estimar.**
- Atualizar `GUIA_LLM.md` (raiz), `app/README.md`, `mcp/README.md`, `services/README.md` e `.env.example` com o que mudou.

---

## 5. Variáveis de ambiente novas (`app/.env.example`)

```env
# --- Cache semântico ---
CACHE_ENABLED=true
CACHE_SIMILARITY_THRESHOLD=0.90
CACHE_TTL_MINUTES=60
CACHE_DB_PATH=./data/cache.sqlite

# --- Embeddings (independente de LLM_PROVIDER): "gemini" | "openai" | "mock" ---
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=

# --- LLM as a judge (use provedor DIFERENTE do LLM_PROVIDER) ---
JUDGE_ENABLED=true
JUDGE_PROVIDER=claude
JUDGE_MODEL=
JUDGE_MAX_REVISIONS=1
JUDGE_EVIDENCE_MAX_CHARS=6000
```

Chaves de API continuam nas variáveis já existentes (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Valores de `*_MODEL` ficam vazios no exemplo: o desenvolvedor define após conferir os modelos vigentes.

---

## 6. Estratégia de testes sem chaves de API

O ambiente de desenvolvimento anterior não tinha chaves reais nem Docker. Portanto:
1. Estenda o `MockAdapter` (mantendo o protocolo `TOOL:<nome>:<json>`) para exercitar as novas tools e o encadeamento.
2. `MockEmbeddingAdapter` e `MockJudgeAdapter` permitem testar cache e juiz de ponta a ponta localmente (`LLM_PROVIDER=mock`, `EMBEDDING_PROVIDER=mock`, `JUDGE_PROVIDER=mock`).
3. Infra local para testes: Postgres + 3 services (`bun run src/index.ts` com `DATABASE_URL`) + 3 MCP (`uv run server.py` com `MCP_PORT`) + `bun run server.ts` do app. Em ambiente sem `setsid` persistente, religue tudo a cada bloco de testes.
4. Testes com provedores reais (Gemini/Claude/GPT, embeddings reais, juiz real) são **responsabilidade do desenvolvedor**; deixe um roteiro curto de `curl` pronto para ele executar e liste explicitamente o que ficou sem validação.

---

## 7. Relatório final esperado

Ao terminar, entregue:
1. Lista de arquivos criados/alterados por subprojeto (completos ou diffs aplicáveis, com instrução de onde colocar).
2. Mudanças de schema e o procedimento de reset (`down -v`).
3. Tabela **Validado × Não validado** (mock vs. provedor real; local vs. Docker).
4. Valores usados/medidos para o limiar de similaridade e para o conjunto de avaliação, com a fonte da medição.
5. Decisões deste guia que foram alteradas e por quê.
6. Pendências abertas (ex.: alternância `APP_ENV` para URLs MCP, lista de modelos de fallback, testes reais).

### Checklist

- [ ] Fase 1: schema + seed, endpoints novos no `service_receitas`, tools MCP novas, testes `curl`/`test_client.py`
- [ ] Fase 2: system prompt de geração de receitas + tool de salvar
- [ ] Fase 3: `JudgePort`, adapter, orquestrador `answerQuestion`, loop de revisão, `evidencias` em `sendChatMessage`
- [ ] Fase 4: `EmbeddingPort`, `SemanticCachePort`, adapters, regras de elegibilidade e invalidação
- [ ] Fase 5: metadados na UI, `/api/metrics`, log JSONL, script de avaliação, documentação atualizada
- [ ] `bun run typecheck` e `bun run build` limpos; relatório da seção 7 entregue
