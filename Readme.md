# Cookings 🍳

Plataforma de cursos de culinária online — projeto acadêmico de serviços web, servidores MCP, cliente e um chatbot especialista. O chat consulta o catálogo por tools, guarda pergunta parecida num cache semântico e passa a resposta por um juiz (outra IA, que pode ser o Ollama local).

## Visão Geral

O projeto tem quatro composes de pasta e um compose na raiz, todos na rede Docker externa `cookings-network`:

```
cookings/
├── services/   → APIs REST em TypeScript (Bun + Hono) — fonte da verdade dos dados
├── mcp/        → Servidores MCP em Python (uv + FastMCP) — expõem os services para a IA
├── app/        → Cliente React + Tailwind, com 2 abas:
│                  • Informações → consome os services diretamente (REST)
│                  • Chatbot     → IA + tools MCP, cache semântico e juiz
├── ollama/     → modelo local qwen2.5:1.5b, só para o juiz
├── docker-compose.yml          → sobe os quatro de uma vez (include)
└── docker-compose.override.yml → ordem de subida e URL do Ollama
```

Cada pasta sobe sozinha. A raiz sobe o conjunto. Não misture os dois ao mesmo tempo: os nomes dos containers batem.

Para uma explicação completa da arquitetura, decisões técnicas e convenções, veja **[Guide.md](./Guide.md)**.

---

## Domínios do Sistema

| Domínio | Serviço TS | Servidor MCP |
|---|---|---|
| Cursos de culinária | `services/service_cursos` | `mcp/mcp_cursos` |
| Matrículas / Alunos | `services/service_matriculas` | `mcp/mcp_matriculas` |
| Receitas / Ingredientes | `services/service_receitas` | `mcp/mcp_receitas` |

---

## Modelagem de Dados

O banco é um **único PostgreSQL**, organizado em **3 schemas** (um por domínio/serviço): `cursos`, `matriculas` e `receitas`. Cada serviço só acessa o seu próprio schema; referências entre domínios (ex: uma receita apontando para um curso) são feitas por UUID simples, sem `FOREIGN KEY` entre schemas — o acoplamento fica em nível de aplicação, não de banco.

| Schema | Tabelas | Descrição |
|---|---|---|
| `cursos` | `cursos`, `aulas` | Catálogo de cursos e suas aulas |
| `matriculas` | `alunos`, `matriculas` | Alunos cadastrados e suas matrículas/progresso em cursos |
| `receitas` | `receitas`, `ingredientes`, `receita_ingredientes`, `substituicoes` | Receitas, ingredientes (com alérgenos), quantidades e substituições |

```
cursos.cursos ──1:N── cursos.aulas
      │                    │
      ▼                    ▼
matriculas.matriculas   receitas.receitas ──1:N── receita_ingredientes ──N:1── ingredientes
      │
      ▼
matriculas.alunos
```

O DDL e o seed estão em `services/db/init/001_seed.sql` (grupo `0000` = amostra original, grupo `0001` = catálogo ampliado). O cache das perguntas do chat não fica nesse Postgres: é um SQLite do `app` (`./data/cache.sqlite`). O desenho do chat está em [docs/PIPELINE_CACHE_JUIZ.md](./docs/PIPELINE_CACHE_JUIZ.md).

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| APIs (`services`) | Bun + Hono + Drizzle ORM + Zod + PostgreSQL |
| MCP (`mcp`) | Python + uv + FastMCP (transporte `streamable-http`) + httpx |
| Cliente (`app`) | React + Vite + TailwindCSS, arquitetura hexagonal |
| IA do chat (`app`) | Gemini, Claude, GPT ou mock (`LLM_PROVIDER`) |
| Juiz (`app`) | Outra IA: Gemini, Claude, GPT, mock ou Ollama `qwen2.5:1.5b` (`JUDGE_PROVIDER`) |
| Cache do chat | SQLite no `app` (`CACHE_DB_PATH`), similaridade por cosseno |
| Banco dos domínios | PostgreSQL único, seed na primeira execução do volume |
| Orquestração | Compose por pasta (`services`, `mcp`, `app`, `ollama`) ou o da raiz, rede `cookings-network` |

---

## Pré-requisitos

- [Docker](https://www.docker.com/) e Docker Compose
- [Bun](https://bun.sh/) (para rodar/testar `services` e `app` localmente fora do Docker, se desejado)
- [uv](https://docs.astral.sh/uv/) (para rodar/testar `mcp` localmente fora do Docker, se desejado)
- Node 22+ (opcional, apenas para scripts/testes pessoais no terminal — os servidores em si rodam em Bun)

---

## Como Rodar o Projeto

### 1. Criar a rede Docker externa (uma única vez)

```bash
docker network create cookings-network
```

### 2. Configurar as variáveis de ambiente

Copie cada `.env.example` para `.env` e preencha os valores necessários:

```bash
# services
cp services/db/.env.example services/db/.env
cp services/service_cursos/.env.example services/service_cursos/.env
cp services/service_matriculas/.env.example services/service_matriculas/.env
cp services/service_receitas/.env.example services/service_receitas/.env

# mcp
cp mcp/mcp_cursos/.env.example mcp/mcp_cursos/.env
cp mcp/mcp_matriculas/.env.example mcp/mcp_matriculas/.env
cp mcp/mcp_receitas/.env.example mcp/mcp_receitas/.env

# app
cp app/.env.example app/.env
```

> No `.env` do `app`, defina `LLM_PROVIDER` (`gemini`, `claude`, `gpt` ou `mock`) e a chave desse provedor. O juiz é outro: `JUDGE_PROVIDER` (`mock`, `gemini`, `claude`, `gpt` ou `ollama`). Cache: `CACHE_ENABLED=true`. O exemplo completo está em `app/.env.example`.

### Subir tudo pela raiz (atalho)

Na raiz do repositório, com a rede criada e os `.env` copiados (passos 1 e 2):

```bash
docker network create cookings-network
docker compose up -d --build
```

O stack na raiz usa `docker-compose.yml` (includes) **e** `docker-compose.override.yml` (volumes fixos, ordem de subida, `OLLAMA_BASE_URL`); o Compose carrega os dois automaticamente — não use só `-f docker-compose.yml`, senão faltam ordem e URL do Ollama.

Sobe de uma vez: Postgres e os três services, os três MCP, o app e o Ollama. O `ollama_pull` baixa `qwen2.5:1.5b` em paralelo e o app não fica preso nele. Na primeira vez, espere esse pull terminar antes de usar o juiz Ollama.

Volumes **com nome fixo** (`cookings_pgdata`, `cookings_cache`, `cookings_ollama`) só valem neste compose da raiz. Se você subir apenas `cd services && docker compose up`, o Postgres continua usando o volume com **prefixo da pasta** do projeto — comportamento padrão do Compose, independente do stack unificado.

**Atenção:** `docker compose down -v` na raiz apaga banco, cache sqlite e modelos Ollama desses volumes nomeados. Não rode sem intenção.

Não suba ao mesmo tempo o compose da raiz e o de uma subpasta: os `container_name` colidem.

Os passos abaixo continuam válidos para subir ou desenvolver **uma parte** do projeto.

### 3. Subir os serviços (`services`)

```bash
cd services
docker compose up -d
```

Na primeira execução, o banco de dados PostgreSQL é populado automaticamente com os dados de `db/init/001_seed.sql`.

### 4. Subir os servidores MCP (`mcp`)

```bash
cd mcp
docker compose up -d
```

### 5. Rodar o cliente (`app`)

**Opção A — modo desenvolvimento (recomendado no dia a dia):**

```bash
cd app
bun install   # ou npm/pnpm install
bun run dev   # ou npm run dev
```

Acesse o endereço indicado pelo Vite (geralmente `http://localhost:5173`).

**Opção B — via Docker (mesma rede `cookings-network` dos outros subprojetos):**

```bash
cd app
docker compose up -d
```

### 6. (Opcional) Juiz local — `ollama/`

Quarto compose, só para o juiz (`JUDGE_PROVIDER=ollama`). Não substitui o LLM principal.

```bash
cd ollama
docker compose up -d
```

Na primeira vez o serviço `ollama_pull` baixa `qwen2.5:1.5b` e pode demorar. URL na rede Docker: `http://ollama:11434`. No Bun do host: `http://127.0.0.1:11434` (`OLLAMA_BASE_URL`).

---

## Estrutura de Pastas Completa

```
cookings/
├── .gitignore
├── services/
│   ├── docker-compose.yml
│   ├── db/
│   │   ├── init/001_seed.sql
│   │   └── .env.example
│   ├── service_cursos/
│   ├── service_matriculas/
│   └── service_receitas/
│
├── mcp/
│   ├── docker-compose.yml
│   ├── mcp_cursos/
│   ├── mcp_matriculas/
│   └── mcp_receitas/
│
├── ollama/
│   ├── docker-compose.yml
│   └── README.md
│
├── app/
│   ├── src/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── ui/
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── .env.example
│
├── docker-compose.yml
├── docker-compose.override.yml
├── docs/
│   └── PIPELINE_CACHE_JUIZ.md
├── Guide.md
└── Readme.md
```

---

## Documentação Adicional

- **[Guide.md](./Guide.md)** — contexto, decisões e convenções.
- **[docs/PIPELINE_CACHE_JUIZ.md](./docs/PIPELINE_CACHE_JUIZ.md)** — caminho da pergunta: cache, IA, tools e juiz.
- **[AGENTS.md](./AGENTS.md)** — como alterar o repositório e como validar.
- Cada subpasta (`services/`, `mcp/`, `app/`, `ollama/`) tem o próprio README de execução isolada.