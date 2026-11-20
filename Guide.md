# Projeto Cookings

---

## 1. Contexto do Projeto

Trabalho acadêmico que exige um back-end composto por **3 ou mais serviços web** + **um cliente que consome todos os serviços** + **acesso via protocolo MCP por uma IA**. É necessário um "mini-mundo" coerente que justifique a existência dos serviços.

**Mini-mundo escolhido: Cookings** — uma plataforma de cursos de culinária online.

Três domínios de informação:
1. **Cursos**
2. **Matrículas/Alunos**
3. **Receitas/Ingredientes**

---

## 2. Estrutura de Pastas (fonte da verdade)

```
cookings/
├── .gitignore
├── services/          # APIs REST em TypeScript (Bun no servidor)
│   ├── docker-compose.yml
│   ├── db/init/       # seed SQL (só roda no 1º up)
│   ├── service_cursos/
│   ├── service_matriculas/
│   └── service_receitas/
│
├── mcp/                # Servidores MCP em Python (uv)
│   ├── docker-compose.yml
│   ├── mcp_cursos/
│   ├── mcp_matriculas/
│   └── mcp_receitas/
│
├── ollama/             # juiz local (qwen2.5:1.5b); não é o LLM do chat
│   └── docker-compose.yml
│
├── app/                # Cliente (React + Tailwind, hexagonal) — ANTES chamado "chatbot"
│   ├── src/
│   │   ├── domain/         # entidades + portas (interfaces)
│   │   ├── application/    # casos de uso (chat: cache → IA → juiz)
│   │   ├── infrastructure/ # adapters (llm/, judge/, cache/, embeddings/, http/)
│   │   └── ui/
│   │       ├── InfoTab/     # aba "Informações" — consome services via REST direto
│   │       └── ChatTab/     # aba "Chatbot" — IA + MCP, selo de cache e juiz
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── .env.example
│
├── docker-compose.yml          # include dos quatro composes
└── docker-compose.override.yml # ordem de subida e OLLAMA_BASE_URL
```

> **Importante**: a pasta chama-se `app`, não `chatbot`. `chatbot` é só o nome informal do módulo de chat dentro dela.
> `services`, `mcp`, `app` e `ollama` sobem cada um pelo próprio `docker-compose.yml`, na rede externa `cookings-network`. A raiz sobe os quatro juntos. Não misture raiz e pasta ao mesmo tempo: os `container_name` colidem.

---

## 3. Papel de Cada Subprojeto

| Pasta | Papel | Quem acessa |
|---|---|---|
| `services` | Fonte da verdade dos dados (CRUD, regras de negócio) | `app` (direto) e `mcp` (indireto, via HTTP) |
| `mcp` | Camada de acesso MCP — traduz tools MCP em chamadas HTTP para `services` | A IA usada pelo `app` |
| `app` | Único cliente humano. Chat: IA principal, tools MCP, cache semântico e juiz | Usuário final |
| `ollama` | Sobe o modelo local do juiz (`qwen2.5:1.5b`). Não responde o chat | O `app`, quando `JUDGE_PROVIDER=ollama` |

**Abas do `app`:**
- **Aba "Informações"**: consome os `services` diretamente via REST (fetch comum), sem passar por IA ou MCP. É a visão "dashboard" tradicional (listagens, CRUD, etc.).
- **Aba "Chatbot"**: `POST /api/chat` → cache semântico → IA principal (Gemini, Claude, GPT ou mock) com tools MCP → juiz (outro provedor, ou Ollama). A resposta mostra se veio do cache e o veredito do juiz. O desenho está em [docs/PIPELINE_CACHE_JUIZ.md](./docs/PIPELINE_CACHE_JUIZ.md).

---

## 4. Stack e Decisões Técnicas (não reabrir esta discussão sem motivo forte)

| Subprojeto | Stack | Observação |
|---|---|---|
| `services` | **Bun** (runtime do servidor) + **Hono** (framework) + **Drizzle ORM** + **Zod** + **PostgreSQL** | O desenvolvedor usa **Node 22** apenas no terminal pessoal para testes/scripts avulsos — o servidor roda em **Bun** dentro do Docker. Não confundir os dois: o `Dockerfile` de cada `service_*` usa imagem Bun. |
| `mcp` | **Python + uv** + **FastMCP** (`mcp` SDK oficial) + **httpx** | Transporte recomendado: **streamable-http** (não `stdio`), pois os containers são separados do `app`. |
| `app` | **React + Vite + TailwindCSS**, arquitetura **hexagonal**, servidor **Bun + Hono** | A IA do chat implementa `LLMPort` (`LLM_PROVIDER=gemini\|claude\|gpt\|mock`). O juiz é outra porta (`JUDGE_PROVIDER`, inclusive `ollama`). O cache é `SqliteSemanticCache` + `EmbeddingPort`. O Docker do app faz o build do Vite e sobe o `server.ts` com Bun, na rede `cookings-network`. |

### Regra de Simplicidade (explícita e importante)
- `services` e `mcp` devem ser **simples e com poucos arquivos** — este é um trabalho de escala pequena, não um sistema de produção.
- Evitar over-engineering: nada de camadas excessivas, DDD complexo, múltiplos bancos, autenticação/autorização elaborada, filas de mensagens, etc.
- Cada `service_*` deve idealmente caber em poucos arquivos (ex: `index.ts`, `db.ts`, `routes.ts`, `schema.ts` — não crie uma estrutura de pastas profunda por serviço).
- Cada `mcp_*` deve idealmente ser **1 arquivo principal** (`server.py`) + `pyproject.toml` + `Dockerfile` + `.env.example`. Só divida em mais arquivos se ficar genuinamente difícil de ler.
- A arquitetura hexagonal **rigorosa** é exigida apenas no `app` (é o requisito específico do projeto: trocar facilmente o provedor de LLM). Não é necessário aplicar hexagonal em `services` ou `mcp`.

---

## 5. Convenções de Nomenclatura

- Pastas de serviço: `service_<nome>` (em `services/`) e `mcp_<nome>` (em `mcp/`), sempre com o **mesmo `<nome>`** para facilitar rastreamento (ex: `service_cursos` ↔ `mcp_cursos`).
- Nomes em português para os domínios: `cursos`, `matriculas`, `receitas` (mantendo consistência em todo o projeto: variáveis, tabelas, rotas).
- Hostnames internos no Docker = nome do container = nome da pasta (ex: `service_cursos`, `mcp_cursos`).

---

## 6. Rede Docker

- Network externa compartilhada: **`cookings-network`**, criada manualmente antes de subir qualquer compose:
  ```bash
  docker network create cookings-network
  ```
- **Quatro composes de pasta** (`services`, `mcp`, `app`, `ollama`) referenciam essa rede como `external: true`. A raiz (`docker-compose.yml` + `docker-compose.override.yml`) inclui os quatro. Não use só `-f docker-compose.yml`: o override traz a ordem e `OLLAMA_BASE_URL=http://ollama:11434`.
- `cookings_ollama` é o servidor do modelo (porta 11434) e fica no ar. `cookings_ollama_pull` baixa `qwen2.5:1.5b` e termina (exit 0 é sucesso). O app não espera esse pull para subir.
- `docker compose down -v` na raiz apaga Postgres, o SQLite do cache e o modelo. Os volumes da raiz têm nome fixo (`cookings_pgdata`, `cookings_cache`, `cookings_ollama`) e não são os volumes prefixados de quem sobe só uma pasta.
- `mcp_*` chama `service_*` via hostname interno (ex: `http://service_cursos:3001`), nunca via `localhost`.
- O `app`, quando executado via Docker, também entra em `cookings-network`; suas chamadas para os `service_*` podem usar o hostname interno (ex: `http://service_cursos:3001`) quando o fetch acontece no lado servidor/build, mas como é uma SPA que roda no **navegador do usuário**, as chamadas feitas pelo browser continuam usando as URLs públicas configuradas em `.env` (ex: `VITE_SERVICE_CURSOS_URL=http://localhost:3001`) — o navegador não resolve hostnames internos do Docker.

---

## 7. Banco de Dados e Modelagem de Dados

- **Um único PostgreSQL**, compartilhado entre os 3 `service_*`, organizado em **3 schemas** (um por domínio) — não criar 3 bancos separados.
- Seed em `services/db/init/001_seed.sql`, montado em `/docker-entrypoint-initdb.d` — só executa quando o volume de dados está vazio (comportamento nativo do Postgres, não precisa de lógica extra).
- Cada `service_*` só deve ler/escrever no **seu próprio schema** (ex: `service_cursos` só toca no schema `cursos`). Isso preserva a separação lógica mesmo compartilhando a mesma instância física de banco — decisão feita para simplificar a infraestrutura em um projeto de escala pequena.
- **Referências entre schemas (ex: uma receita que aponta para um curso) são armazenadas como colunas simples (UUID), sem `FOREIGN KEY` cross-schema.** Isso é intencional: em uma arquitetura de serviços, cada serviço não deve depender do esquema interno de outro — o acoplamento é feito em nível de aplicação, não de banco. FKs só existem **dentro do mesmo schema**.

### 7.1 Entidades por Domínio

**Schema `cursos`** (dono: `service_cursos`)
| Tabela | Campos principais |
|---|---|
| `cursos.cursos` | `id` (uuid, pk), `titulo`, `descricao`, `categoria`, `nivel` (`iniciante`\|`intermediario`\|`avancado`), `instrutor_nome`, `carga_horaria_horas` (int), `preco` (numeric), `criado_em` (timestamp) |
| `cursos.aulas` | `id` (uuid, pk), `curso_id` (uuid, **FK** → `cursos.cursos.id`), `titulo`, `ordem` (int), `duracao_minutos` (int) |

**Schema `matriculas`** (dono: `service_matriculas`)
| Tabela | Campos principais |
|---|---|
| `matriculas.alunos` | `id` (uuid, pk), `nome`, `email` (unique), `criado_em` (timestamp) |
| `matriculas.matriculas` | `id` (uuid, pk), `aluno_id` (uuid, **FK** → `matriculas.alunos.id`), `curso_id` (uuid, referência a `cursos.cursos.id`, **sem FK**), `data_matricula` (timestamp), `progresso_percentual` (int, 0–100), `status` (`ativa`\|`concluida`\|`cancelada`), `certificado_emitido` (boolean) |

**Schema `receitas`** (dono: `service_receitas`)
| Tabela | Campos principais |
|---|---|
| `receitas.ingredientes` | `id`, `nome` (unique), `unidade_padrao`, `alergenos TEXT[]` (vocabulário: `gluten`, `lactose`, `ovo`, `soja`, `amendoim`, `castanhas`, `peixe`, `crustaceos`) |
| `receitas.receitas` | `id`, `curso_id` (sem FK, nulo só se `origem = ia`), `aula_id` (sem FK, nullable), `nome`, `modo_preparo`, `tempo_preparo_minutos`, `porcoes`, `origem` (`curso`\|`ia`) |
| `receitas.receita_ingredientes` | `id`, `receita_id` (**FK**), `ingrediente_id` (**FK**), `quantidade`, `unidade`, `observacao` |
| `receitas.substituicoes` | `id`, `ingrediente_id` (**FK**, cascade), `substituto` (texto livre), `observacao` |

### 7.2 Diagrama de Relacionamento (conceitual)

```
cursos.cursos ──1:N── cursos.aulas
      │
      │ (referência sem FK)
      ▼
matriculas.matriculas ──N:1── matriculas.alunos

cursos.cursos / cursos.aulas
      │ (referência sem FK)
      ▼
receitas.receitas ──1:N── receitas.receita_ingredientes ──N:1── receitas.ingredientes
receitas.ingredientes ──1:N── receitas.substituicoes
```

### 7.3 DDL de Referência

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- para gen_random_uuid()

CREATE SCHEMA IF NOT EXISTS cursos;
CREATE SCHEMA IF NOT EXISTS matriculas;
CREATE SCHEMA IF NOT EXISTS receitas;

-- === schema cursos ===
CREATE TABLE cursos.cursos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  descricao TEXT,
  categoria TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('iniciante','intermediario','avancado')),
  instrutor_nome TEXT NOT NULL,
  carga_horaria_horas INT NOT NULL,
  preco NUMERIC(10,2) NOT NULL DEFAULT 0,
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE cursos.aulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id UUID NOT NULL REFERENCES cursos.cursos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  ordem INT NOT NULL,
  duracao_minutos INT NOT NULL
);

-- === schema matriculas ===
CREATE TABLE matriculas.alunos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE matriculas.matriculas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id UUID NOT NULL REFERENCES matriculas.alunos(id) ON DELETE CASCADE,
  curso_id UUID NOT NULL, -- referência lógica a cursos.cursos.id (sem FK cross-schema)
  data_matricula TIMESTAMP NOT NULL DEFAULT now(),
  progresso_percentual INT NOT NULL DEFAULT 0 CHECK (progresso_percentual BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','concluida','cancelada')),
  certificado_emitido BOOLEAN NOT NULL DEFAULT false
);

-- === schema receitas ===
CREATE TABLE receitas.ingredientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  unidade_padrao TEXT NOT NULL,
  alergenos TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT ingredientes_alergenos_vocab_chk CHECK (
    alergenos <@ ARRAY['gluten','lactose','ovo','soja','amendoim','castanhas','peixe','crustaceos']::TEXT[]
  )
);

CREATE TABLE receitas.receitas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id UUID,                -- referência lógica, sem FK; nulo só quando origem = 'ia'
  aula_id UUID,
  nome TEXT NOT NULL,
  modo_preparo TEXT NOT NULL,
  tempo_preparo_minutos INT NOT NULL,
  porcoes INT NOT NULL DEFAULT 1,
  origem TEXT NOT NULL DEFAULT 'curso' CHECK (origem IN ('curso', 'ia')),
  CONSTRAINT receitas_origem_curso_chk CHECK (origem <> 'curso' OR curso_id IS NOT NULL)
);

CREATE TABLE receitas.receita_ingredientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receita_id UUID NOT NULL REFERENCES receitas.receitas(id) ON DELETE CASCADE,
  ingrediente_id UUID NOT NULL REFERENCES receitas.ingredientes(id) ON DELETE RESTRICT,
  quantidade NUMERIC(10,2) NOT NULL,
  unidade TEXT NOT NULL,
  observacao TEXT
);

CREATE TABLE receitas.substituicoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingrediente_id UUID NOT NULL REFERENCES receitas.ingredientes(id) ON DELETE CASCADE,
  substituto TEXT NOT NULL,
  observacao TEXT
);
```

> Este DDL, mais os `INSERT`s de dados de exemplo, já está escrito em `services/db/init/001_seed.sql`.
>
> **Nota**: o seed usa **IDs fixos**. Prefixo por entidade: `1000` cursos, `2000` aulas, `3000` alunos, `4000` matrículas, `5000` ingredientes, `6000` receitas, `7000` substituições. Grupo `0000` é a amostra original; grupo `0001` é o catálogo ampliado. Exemplo: o curso "Fundamentos da Culinária Italiana" é `10000000-0000-0000-0000-000000000001`. O arquivo SQL do seed é a fonte da verdade; este bloco é o recorte do schema.

### 7.4 Endpoints Esperados por Serviço (referência para implementação)

| Serviço | Endpoints principais |
|---|---|
| `service_cursos` | `GET/POST /cursos`, `GET/PUT/DELETE /cursos/:id`, `GET /cursos/:id/aulas`, `POST /cursos/:id/aulas` |
| `service_matriculas` | `GET/POST /alunos`, `GET /alunos/:id`, `GET/POST /matriculas`, `GET /matriculas/:id`, `PATCH /matriculas/:id/progresso` |
| `service_receitas` | `GET/POST /receitas` (filtros `ingrediente`, `modo`, `nome`), `GET /receitas/:id` (com alérgenos), `GET/POST /ingredientes`, `GET /ingredientes/:id/substituicoes`, `POST /receitas/:id/ingredientes`. Receita `origem=ia` pode nascer sem `cursoId` |

---

## 8. Padrão de Variáveis de Ambiente

- Todo serviço/app tem um `.env.example` (sem valores sensíveis) — o desenvolvedor preenche o `.env` real manualmente.
- Nunca sugerir preencher ou "adivinhar" valores de API key nos `.env.example`.

---

## 9. O Que NÃO Fazer

- Não sugerir autenticação/autorização (JWT, OAuth, etc.) a menos que explicitamente pedido — fora do escopo do trabalho.
- Não criar outro Postgres nem um banco por serviço. O cache semântico é a exceção combinada: um arquivo SQLite dentro do `app` (`CACHE_DB_PATH`), não um schema do `cookings_db`.
- Não criar `FOREIGN KEY` entre schemas diferentes (ex: `receitas` apontando para `cursos`) — a referência é sempre lógica (só a coluna UUID), nunca uma constraint de banco.
- Não usar `stdio` como transporte MCP (não funciona bem entre containers separados).
- Não renomear `app` de volta para `chatbot`, nem `services`/`mcp` para outros nomes, sem confirmação explícita.
- Não adicionar frameworks pesados (NestJS, Next.js, Django, etc.) — a stack escolhida (Hono/Bun, FastMCP/uv, Vite/React) já é intencionalmente minimalista.
- Não multiplicar arquivos/camadas em `services` e `mcp` — a exigência de "poucos arquivos" é uma decisão explícita do desenvolvedor.

---

## 10. Estado Atual / Próximos Passos

> Esta seção deve ser **atualizada conforme o projeto avança**, para que uma LLM futura saiba exatamente onde o projeto está.

- [x] `services`, `mcp` e `app` implementados e ligados pela rede `cookings-network`
- [x] Seed ampliado (grupo `0001`) e schema de alérgenos, `origem` e `substituicoes`
- [x] Tools MCP de busca, alérgeno, porções, lista de compras, receita gerada, substituição e resumo de progresso
- [x] Cache semântico (SQLite no `app`) e juiz (`JUDGE_PROVIDER`, inclusive Ollama `qwen2.5:1.5b`)
- [x] Compose da raiz inclui `services`, `mcp`, `app` e `ollama`
- [ ] Prova com chave real de Gemini/Claude/GPT e com o juiz Ollama no ambiente de quem desenvolve (a esteira com `LLM_PROVIDER=mock` roda sem chave)

---

## 11. Referência Rápida

| Item | Valor |
|---|---|
| Network Docker | `cookings-network` |
| Tema | Cookings (plataforma de cursos de culinária) |
| Domínios | cursos, matriculas, receitas |
| Runtime services (Docker) | Bun |
| Runtime terminal pessoal (testes) | Node 22 |
| Framework services | Hono |
| ORM | Drizzle |
| Banco | PostgreSQL (único), 3 schemas: `cursos`, `matriculas`, `receitas` |
| Gerenciador Python | uv |
| SDK MCP | FastMCP (`mcp` oficial) |
| Transporte MCP | streamable-http |
| Frontend | React + Vite + Tailwind |
| Orquestração | Compose por pasta (`services`, `mcp`, `app`, `ollama`) ou o da raiz, rede `cookings-network` |
| Arquitetura do app | Hexagonal: `LLMPort`, `JudgePort`, `EmbeddingPort`, `SemanticCachePort` |
| IA do chat | `LLM_PROVIDER`: gemini, claude, gpt ou mock |
| Juiz | `JUDGE_PROVIDER` diferente do chat; Ollama usa `qwen2.5:1.5b` |
| Cache do chat | SQLite `./data/cache.sqlite`, cosseno, TTL |