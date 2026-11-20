# AGENTS.md — Cookings

Guia operacional para agentes que alteram este repositório. Leia isto e o código citado antes de editar. Especificação da evolução (cache, juiz, receitas por IA): `docs/GUIA_EVOLUCAO_LLM.md`. Arquitetura longa: `Guide.md`. Subida do ambiente: `Readme.md`.

## Papel do modelo principal

Planeje, revise e integre. Implementação de código vai para subagentes Opus ou Sonnet (`model: "opus"` ou `model: "sonnet"`). Não declare nada testado sem ter executado o comando. Separe o que rodou do que ficou de fora.

## Mapa

Quatro composes por pasta na rede Docker externa `cookings-network` (`docker network create cookings-network` uma vez); na **raiz**, `docker-compose.yml` (include) + `docker-compose.override.yml` (mescla automática; não subir só com `-f` no primeiro) unem services, mcp, app e ollama — `docker compose down -v` **na raiz** apaga volumes (Postgres, cache, modelos Ollama).

| Pasta | Stack | Papel | Portas no host |
|---|---|---|---|
| `services/` | Bun, Hono, Drizzle, Zod, PostgreSQL 16 | Fonte da verdade | 3001 cursos, 3002 matrículas, 3003 receitas, 5432 Postgres (`cookings_db`) |
| `mcp/` | Python, uv, FastMCP `streamable-http`, httpx | Tradutor MCP → HTTP. Sem acesso direto ao banco | 8001 cursos, 8002 matrículas, 8003 receitas (container escuta 8000) |
| `app/` | React, Vite, Tailwind, backend Bun/Hono | Aba Informações (REST no navegador) e aba Chatbot (`POST /api/chat`) | 5173 Vite, 3000 API |
| `ollama/` | Ollama `qwen2.5:1.5b` | Juiz local opcional. Não é `LLM_PROVIDER` | 11434 |

Um Postgres, três schemas: `cursos`, `matriculas`, `receitas`. Cada `service_*` só fala com o próprio schema. UUID entre schemas não tem `FOREIGN KEY`.

Seed: `services/db/init/001_seed.sql`. O Postgres só executa `db/init/` com volume vazio. IDs fixos por prefixo: `1000` cursos, `2000` aulas, `3000` alunos, `4000` matrículas, `5000` ingredientes, `6000` receitas, `7000` substituições. Grupo `0000` é a amostra original; grupo `0001` é o catálogo ampliado (+100 em cada tabela; vínculos de receita somam 416 porque cada receita nova tem 4 ingredientes). Totais: 103 cursos, 107 aulas, 103 alunos, 104 matrículas, 112 ingredientes, 103 receitas, 105 substituições.

## Regras que não se negociam

- Comentários, docstrings de tools e docs em português.
- Não leia `.env`. Use só `.env.example`. Nunca grave chave de API.
- `services/` e `mcp/`: poucos arquivos. Service = `src/index.ts`, `db.ts`, `schema.ts`, `routes.ts`. MCP = `server.py`. Sem auth, sem camada extra.
- `app/`: hexagonal. `domain/` (entidades e portas) → `application/` (casos de uso) → `infrastructure/` (adapters) → `ui/`. A aplicação só conhece portas. Trocar Gemini, Claude, GPT ou mock é `.env` (`LLM_PROVIDER`) mais `llmFactory.ts`. Nenhuma regra de provedor vaza para `application/`.
- Erro de service: `{ "error": "...", "details": [...] }` via `zValidator` em `routes.ts`. JSON camelCase. `preco` e `quantidade` (`NUMERIC`) chegam como string.
- Erro de tool MCP: `{ "erro": true, "status": ..., "detalhe": ... }`. Transporte sempre `streamable-http`, nunca `stdio`.
- Nome de parâmetro de tool: copie de `mcp/*/server.py`. Não invente.
- Mudança de schema no seed exige recriar o volume. `docker compose down -v` em `services/` apaga o banco inteiro, inclusive dados criados em uso. Avise antes de rodar.

## Padrões por pasta

### services

- Hono + Zod. Validação ruim responde 400 `{ error: "Dados inválidos", details }`. Ausência responde 404 `{ error }`. Conflito de nome (ingrediente) responde 409.
- Drizzle declara só o schema dono (`pgSchema("receitas")` etc.). Coluna nova no SQL não aparece na API enquanto não entrar em `schema.ts` e na rota. `service_receitas` já expõe `alergenos`, `origem` e `GET /ingredientes/:id/substituicoes`.
- `DATABASE_URL` no `.env` do service. Hostname Docker do banco: `db`. Fora do Docker: `127.0.0.1`.
- Senha de `services/db/.env` igual à senha dentro de cada `DATABASE_URL`.

### mcp

- `FastMCP(..., host="0.0.0.0", port=MCP_PORT)`. Default de URL do service é `localhost:300x`; no compose, `SERVICE_*_URL=http://service_*:300x`.
- `_request` traduz HTTP do service. 204 vira `{ "ok": true }`. Falha de rede: `status: null`.
- Tool nova: docstring em português (a IA escolhe pelo texto), mesmo formato de erro, sem SQL.
- Tools atuais: ver `mcp/README.md` (lista completa, inclusive busca, alérgenos, porções, lista de compras, salvar receita gerada, substituições, resumo de progresso). Nomes de parâmetro: copie de `mcp/*/server.py`.

### app

- Chat: `ui/ChatTab` → `POST /api/chat` → `answerQuestion` (cache semântico → `sendChatMessage` loop `MAX_TOOL_ITERATIONS = 8` → juiz) → `LLMPort.converse` → `McpToolsAdapter` → MCP → services. Resposta `{ reply, toolCallsExecuted, evidencias, judge, cache }`. HIT de cache não chama a LLM principal.
- Tools novas no MCP (receitas/cursos/matrículas) entram na lista de tools do loop; mutáveis invalidam o cache do domínio (`domain/toolPolicy.ts`).
- Juiz (`JUDGE_*`) e embeddings (`EMBEDDING_*`) são portas próprias; provedor ≠ `LLM_PROVIDER`. Mock para esteira sem chave. O juiz aceita `JUDGE_PROVIDER=ollama` (`qwen2.5:1.5b` em `ollama/`); ollama não é `LLM_PROVIDER`. O juiz Ollama manda `format` (JSON schema do veredito), `temperature: 0` e `keep_alive`. `JUDGE_TIMEOUT_MS` (padrão 60000) vale para qualquer provedor do juiz: estourou, aborta e vira indisponível. Não vale para `ollama` (espera sem limite; o app também usa `idleTimeout: 0` e `timeout: false` no fetch). `JUDGE_MODE` (`completo` | `relevancia`, lido em `judgeFactory.ts`): padrão `relevancia` com ollama (`RelevanceJudgeAdapter`, JSON `{motivo, atende}`, sem evidências), `completo` nos demais. O veredito leva `modo` e `motivo` opcionais até a UI.
- Estado do chat fica em `ui/App.tsx` (sobrevive à troca de aba). Persistência opcional em `localStorage` (`ChatHistoryStorage.ts`), com consentimento. Histórico antigo `{role, content}` continua válido; metadados (cache/juiz) são opcionais.
- UI: texto puro (`whitespace-pre-wrap`), selo de origem ("Gerado por AI" azul / "Resposta do Cache" cinza, detalhe como similaridade e motivo no tooltip `title`) e `<details>` do juiz colorido por veredito (aprovada verde, revisar âmbar, reprovada vermelho, indisponível cinza), oculto em HIT de cache. Sem markdown.
- `GET /api/metrics`: contadores em memória. `EVAL_LOG_PATH`: JSONL por resposta (opcional).
- Front da aba Informações chama os services no navegador (`VITE_SERVICE_*_URL`, localhost publicado). Hostname interno de container não resolve no browser.
- URLs MCP: `server.ts` usa `MCP_*_URL` e, se `APP_ENV=local` (script `dev:server`), `MCP_*_URL_DEV`.
- Adapters LLM: `GeminiAdapter`, `ClaudeAdapter`, `GptAdapter`, `MockAdapter`. `OllamaAdapter` não entra em `llmFactory.ts`. Gemini fica com um modelo (`GEMINI_MODEL`, padrão `gemini-flash-latest`). Claude e GPT aceitam lista separada por vírgula (`CLAUDE_MODEL`, `OPENAI_MODEL`): só HTTP 404 troca de modelo. 401/403/400 não trocam. 429/503 (e 529 no Claude) fazem retry com backoff no mesmo modelo.
- Gemini: `functionResponse.response` tem de ser objeto; `thoughtSignature` volta igual, sem edição. Lista vazia de tool MCP pode chegar como `null`; lista de um item pode chegar como objeto.
- Contar pergunta do usuário: só `role === "user"`. A saudação inicial do assistente entra no histórico.

## Como validar

Não marque como testado o que não rodou. Chave real e `docker compose` são do ambiente de quem desenvolve; se não houver chave ou Docker, diga isso.

### App (sempre que mexer em `app/`)

```bash
cd app
bun test
bun run typecheck
bun run build
bun run scripts/eval.ts
```

Esteira sem chave: `LLM_PROVIDER=mock`, `JUDGE_PROVIDER=mock`, `EMBEDDING_PROVIDER=mock` no `.env` (ver `app/.env.example`). `MockAdapter` usa o protocolo `TOOL:<nome>:<json>`.

### Services

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
curl http://localhost:3003/receitas
curl http://localhost:3003/receitas/60000000-0000-0000-0000-000000000001
curl http://localhost:3003/ingredientes
```

Fora do Docker, na pasta do service: `bun install`, copiar `.env.example` para `.env`, `bun run dev`.

### Banco, depois de mudar `001_seed.sql`

Confirme com a pessoa antes: o comando abaixo apaga todos os dados.

```bash
cd services
docker compose down -v
docker compose up -d --build
docker exec -it cookings_db psql -U cookings -d cookings -c "select nome, alergenos from receitas.ingredientes;"
docker exec -it cookings_db psql -U cookings -d cookings -c "select count(*) from receitas.substituicoes;"
```

Usuário e database padrão: `cookings` (`services/db/.env.example`).

### MCP

Com os três services no ar e o servidor MCP no ar:

```bash
cd mcp
uv run python test_client.py http://localhost:8003/mcp "[{\"tool\":\"listar_receitas\",\"args\":{}}]"
uv run python test_client.py http://localhost:8001/mcp "[{\"tool\":\"listar_cursos\",\"args\":{}}]"
uv run python test_client.py http://localhost:8002/mcp "[{\"tool\":\"listar_alunos\",\"args\":{}}]"
```

Dentro de cada `mcp_*`: `uv sync --frozen` depois de mudar dependência. No compose, MCP acha o service pelo hostname (`http://service_receitas:3003`). Fora do Docker, aponte `SERVICE_*_URL` para `http://localhost:300x`.

### O que ainda não é prova

- `bun run typecheck` não prova Claude, GPT nem Gemini de verdade.
- Curl de receita não prova tool MCP.
- Seed aplicado num Postgres descartável não prova o volume Docker de quem desenvolve.
- Nomes de modelo e preço mudam: confira a doc do provedor na hora. Não copie ID de memória. O `.env.example` já lista fallback; IDs podem estar velhos.

## Estado útil

Fases 1–5 do `docs/GUIA_EVOLUCAO_LLM.md` estão no código (tools MCP novas, geração, juiz, cache, UI/métricas/eval). Validar o app com `bun test`, `typecheck`, `build` e `bun run scripts/eval.ts`. Juiz real, embeddings reais e Docker ficam no ambiente de quem desenvolve.
