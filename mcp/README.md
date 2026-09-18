# `mcp/` — Cookings

Servidores MCP em **Python + uv + FastMCP**, que traduzem chamadas MCP (usadas por uma IA) em chamadas HTTP para os serviços da pasta `services/`. Ver `GUIA_LLM.md` (raiz do projeto) para o contexto arquitetural completo.

Nenhum destes servidores acessa o banco de dados diretamente — cada um é um tradutor **MCP → HTTP** para o `service_*` correspondente.

## Servidores

| Servidor | Porta MCP | Chama | Tools expostas |
|---|---|---|---|
| `mcp_cursos` | `8001` | `service_cursos` (`3001`) | `listar_cursos`, `obter_curso`, `listar_aulas_do_curso`, `criar_curso`, `criar_aula` |
| `mcp_matriculas` | `8002` | `service_matriculas` (`3002`) | `listar_alunos`, `obter_aluno`, `cadastrar_aluno`, `listar_matriculas`, `obter_matricula`, `matricular_aluno`, `atualizar_progresso_matricula` |
| `mcp_receitas` | `8003` | `service_receitas` (`3003`) | `listar_receitas`, `obter_receita`, `criar_receita`, `listar_ingredientes`, `adicionar_ingrediente_a_receita` |

Transporte: **`streamable-http`** (não `stdio`), pois os servidores rodam em containers separados dos consumidores — ver `GUIA_LLM.md`, seção 6. Cada servidor expõe o protocolo MCP em `http://<host>:<porta>/mcp`.

## Como Rodar (Docker — recomendado)

Pressupõe que a rede `cookings-network` já existe e que os `service_*` de `services/` já estão no ar (os servidores MCP dependem deles para responder às tools).

```bash
# 1. Configurar variáveis de ambiente
cp mcp_cursos/.env.example mcp_cursos/.env
cp mcp_matriculas/.env.example mcp_matriculas/.env
cp mcp_receitas/.env.example mcp_receitas/.env

# 2. Subir
docker compose up -d --build
```

## Como Rodar (sem Docker, para desenvolvimento rápido)

Requer [uv](https://docs.astral.sh/uv/) instalado e os `service_*` acessíveis (local ou remoto).

```bash
cd mcp_cursos   # (ou mcp_matriculas / mcp_receitas)
uv sync
cp .env.example .env
# edite .env: aponte SERVICE_*_URL para onde o service correspondente está rodando
# (ex: http://localhost:3001 em vez de http://service_cursos:3001, fora do Docker)
uv run server.py
```

## Testando os Servidores

Inclui um cliente MCP genérico (`test_client.py`, na raiz desta pasta) usado durante o desenvolvimento para validar cada servidor via protocolo MCP real (não apenas HTTP cru):

```bash
uv run --with mcp --with httpx python test_client.py \
  "http://localhost:8001/mcp" \
  '[{"tool":"listar_cursos","args":{}}]'
```

O primeiro argumento é a URL do servidor MCP (`/mcp` no final), o segundo é uma lista JSON de chamadas `{"tool": "...", "args": {...}}`. O script conecta, lista as tools disponíveis e executa cada chamada, imprimindo o resultado.

Alternativa gráfica: [MCP Inspector](https://github.com/modelcontextprotocol/inspector) (`npx @modelcontextprotocol/inspector`), apontando para a URL `http://localhost:<porta>/mcp` com transporte "Streamable HTTP".

## O Que Já Foi Validado

Os 3 servidores foram testados de ponta a ponta com um **cliente MCP real** (`mcp.client.streamable_http` + `ClientSession`, o mesmo mecanismo que uma IA usaria), contra os `service_*` reais rodando sobre um Postgres real — não apenas testes HTTP diretos aos services. Isso cobre a cadeia completa: **cliente MCP → servidor MCP (streamable-http) → httpx → service_* → Postgres**.

Casos cobertos:
- `mcp_cursos`: listagem com e sem filtro (`categoria`), detalhe de curso, listagem de aulas, e o caso de erro (curso inexistente → `{"erro": true, "status": 404, ...}`).
- `mcp_matriculas`: listagem de alunos com filtro local por nome, cadastro de aluno, matrícula (incluindo erro com aluno inexistente), e atualização de progresso — confirmando que a regra de conclusão automática (100% → `concluida` + certificado) se propaga corretamente do `service_matriculas` até a resposta da tool MCP.
- `mcp_receitas`: listagem e detalhe de receita **com o `JOIN` de ingredientes** (incluindo a observação de substituição vinda do seed), listagem do catálogo de ingredientes, e o caso de erro (receita inexistente → 404).

**Não validado neste ambiente** (sem Docker disponível durante a construção): o build real das imagens Docker e a subida via `docker-compose.yml`, e a integração com um cliente de IA de verdade (Gemini/Claude/GPT fazendo tool calling contra estes servidores) — isso só poderá ser validado quando o `app` (pasta ainda não construída) existir. Os `Dockerfile`s seguem a imagem oficial `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` com `uv sync --frozen` a partir do `uv.lock` — **recomenda-se rodar `docker compose up -d --build` e revalidar com o `test_client.py` (ajustando a URL para a porta publicada) antes de considerar esta etapa 100% encerrada.**

## O Que NÃO Fazer Aqui (lembrete)

- Não acessar o banco de dados diretamente destes servidores — sempre passar pelo `service_*` via HTTP.
- Não usar transporte `stdio`.
- Não adicionar mais arquivos além de `server.py` + `pyproject.toml` + `uv.lock` + `Dockerfile` + `.env.example` por servidor, salvo necessidade real.
- Não validar `curso_id`/`aula_id` cruzando com `service_cursos` nas tools de `mcp_receitas`/`mcp_matriculas` — mantido simples de propósito, igual ao `services/`.

## Estrutura

```
mcp/
├── docker-compose.yml
├── test_client.py          # utilitário de teste manual (não faz parte do runtime)
├── mcp_cursos/       (server.py, pyproject.toml, uv.lock, Dockerfile, .env.example)
├── mcp_matriculas/   (mesma estrutura)
└── mcp_receitas/     (mesma estrutura)
```
