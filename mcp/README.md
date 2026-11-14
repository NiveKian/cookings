# `mcp/` — Cookings

Servidores MCP em **Python + uv + FastMCP**, que traduzem chamadas MCP (usadas por uma IA) em chamadas HTTP para os serviços da pasta `services/`. Ver `GUIA_LLM.md` (raiz do projeto) para o contexto arquitetural completo.

Nenhum destes servidores acessa o banco de dados diretamente — cada um é um tradutor **MCP → HTTP** para o `service_*` correspondente.

## Servidores

| Servidor | Porta MCP | Chama | Tools expostas |
|---|---|---|---|
| `mcp_cursos` | `8001` | `service_cursos` (`3001`) | `listar_cursos`, `obter_curso`, `listar_aulas_do_curso`, `criar_curso`, `criar_aula`, `buscar_cursos_por_texto` |
| `mcp_matriculas` | `8002` | `service_matriculas` (`3002`) | `listar_alunos`, `obter_aluno`, `cadastrar_aluno`, `listar_matriculas`, `obter_matricula`, `matricular_aluno`, `atualizar_progresso_matricula`, `resumo_progresso_aluno` |
| `mcp_receitas` | `8003` | `service_receitas` (`3003`) | `listar_receitas`, `obter_receita`, `criar_receita`, `listar_ingredientes`, `adicionar_ingrediente_a_receita`, `buscar_receitas_por_ingredientes`, `verificar_alergenos`, `ajustar_porcoes`, `gerar_lista_de_compras`, `salvar_receita_gerada`, `sugerir_substituicoes` |

Listagens percorrem todas as páginas (`limit=200`). Tools que só calculam (`ajustar_porcoes`, `gerar_lista_de_compras`, `verificar_alergenos`, `buscar_*`, `sugerir_substituicoes`) não gravam. `salvar_receita_gerada` grava com `origem=ia`.

Exemplo (services no ar):

```bash
uv run --with mcp --with httpx python test_client.py \
  "http://localhost:8003/mcp" \
  '[{"tool":"buscar_receitas_por_ingredientes","args":{"ingredientes":["manteiga","leite"],"modo":"todos"}}]'
```

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

## Estrutura

```
mcp/
├── docker-compose.yml
├── test_client.py          # utilitário de teste manual (não faz parte do runtime)
├── mcp_cursos/       (server.py, pyproject.toml, uv.lock, Dockerfile, .env.example)
├── mcp_matriculas/   (mesma estrutura)
└── mcp_receitas/     (mesma estrutura)
```
