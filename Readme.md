# Cookings 🍳

Plataforma de cursos de culinária online — projeto acadêmico que demonstra uma arquitetura de **serviços web + servidores MCP + IA + cliente**, em torno de um mini-mundo coerente (cursos, matrículas de alunos e receitas/ingredientes).

## Visão Geral

O projeto é dividido em 3 subprojetos independentes, cada um em sua pasta, comunicando-se via uma rede Docker externa compartilhada:

```
cookings/
├── services/   → APIs REST em TypeScript (Bun + Hono) — fonte da verdade dos dados
├── mcp/        → Servidores MCP em Python (uv + FastMCP) — expõem os services para uma IA
└── app/        → Cliente React + Tailwind, com 2 abas:
                   • Informações → consome os services diretamente (REST)
                   • Chatbot     → conversa com a IA, que usa os servidores MCP como ferramentas
```

Os **3 subprojetos** (`services`, `mcp` e `app`) têm cada um seu próprio `docker-compose.yml` e sobem na mesma rede Docker externa `cookings-network`, podendo ser executados de forma independente ou em conjunto.

Para uma explicação completa da arquitetura, decisões técnicas e convenções, veja **[GUIA_LLM.md](./GUIA_LLM.md)**.

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
| `receitas` | `receitas`, `ingredientes`, `receita_ingredientes` | Receitas vinculadas a cursos/aulas, seus ingredientes e quantidades |

```
cursos.cursos ──1:N── cursos.aulas
      │                    │
      ▼                    ▼
matriculas.matriculas   receitas.receitas ──1:N── receita_ingredientes ──N:1── ingredientes
      │
      ▼
matriculas.alunos
```

O DDL completo (criação de schemas, tabelas, constraints e tipos) está documentado na seção **7 — "Banco de Dados e Modelagem de Dados"** do [GUIA_LLM.md](./GUIA_LLM.md#7-banco-de-dados-e-modelagem-de-dados), e já está implementado, junto com dados de exemplo, em `services/db/init/001_seed.sql`.

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| APIs (`services`) | Bun + Hono + Drizzle ORM + Zod + PostgreSQL |
| MCP (`mcp`) | Python + uv + FastMCP (transporte `streamable-http`) + httpx |
| Cliente (`app`) | React + Vite + TailwindCSS, arquitetura hexagonal |
| IA (`app`) | Gemini (padrão), trocável para Claude ou GPT via `.env` |
| Banco de dados | PostgreSQL único, com seed automático na primeira execução |
| Orquestração | 3× Docker Compose independentes (`services`, `mcp`, `app`) + rede externa `cookings-network` |

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

> No `.env` do `app`, defina `LLM_PROVIDER` (`gemini`, `claude` ou `gpt`) e a respectiva API key.

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
├── GUIA_LLM.md
└── README.md
```

---

## Documentação Adicional

- **[GUIA_LLM.md](./GUIA_LLM.md)** — guia de orientação com contexto arquitetural completo, decisões técnicas e convenções (recomendado para quem for dar manutenção ao projeto com apoio de uma IA).
- Cada subpasta (`services/`, `mcp/`, `app/`) deve conter seu próprio `README.md` com instruções específicas de execução isolada.