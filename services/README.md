# `services/` — Cookings

APIs REST em **TypeScript + Bun + Hono + Drizzle ORM**, responsáveis pelos dados de cursos, matrículas e receitas do Cookings. Ver também `GUIA_LLM.md` (raiz do projeto) para o contexto arquitetural completo.

## Serviços

| Serviço | Porta | Schema no banco |
|---|---|---|
| `service_cursos` | `3001` | `cursos` |
| `service_matriculas` | `3002` | `matriculas` |
| `service_receitas` | `3003` | `receitas` |

Todos compartilham a **mesma instância PostgreSQL** (container `db`), cada um restrito ao seu próprio schema. Referências entre schemas (ex: `matriculas.curso_id` → `cursos.cursos.id`) são apenas colunas UUID, sem `FOREIGN KEY` entre schemas — decisão intencional documentada no `GUIA_LLM.md`.

## Como Rodar (Docker — recomendado)

```bash
# 1. Criar a rede externa (uma única vez, se ainda não existir)
docker network create cookings-network

# 2. Configurar variáveis de ambiente
cp db/.env.example db/.env
cp service_cursos/.env.example service_cursos/.env
cp service_matriculas/.env.example service_matriculas/.env
cp service_receitas/.env.example service_receitas/.env
# edite os arquivos .env e defina uma senha real (a mesma em db/.env e em cada DATABASE_URL)

# 3. Subir tudo
docker compose up -d --build

# 4. Acompanhar logs se necessário
docker compose logs -f
```

Na primeira subida, o Postgres executa automaticamente `db/init/001_seed.sql`, criando os 3 schemas, as 7 tabelas e os dados de exemplo.

## Como Rodar (sem Docker, para desenvolvimento rápido)

Requer Bun instalado (`curl -fsSL https://bun.sh/install | bash`) e um Postgres acessível (local ou remoto) com o schema já aplicado via `db/init/001_seed.sql`.

```bash
cd service_cursos   # (ou service_matriculas / service_receitas)
bun install
cp .env.example .env
# edite .env: ajuste DATABASE_URL para apontar ao seu Postgres (ex: 127.0.0.1 em vez de "db")
bun run dev
```

## Testando os Endpoints

Cada serviço expõe `GET /health` para verificação rápida:

```bash
curl http://localhost:3001/health   # service_cursos
curl http://localhost:3002/health   # service_matriculas
curl http://localhost:3003/health   # service_receitas
```

Exemplos completos (todos testados manualmente durante o desenvolvimento):

```bash
# Cursos
curl http://localhost:3001/cursos
curl http://localhost:3001/cursos/10000000-0000-0000-0000-000000000001
curl http://localhost:3001/cursos/10000000-0000-0000-0000-000000000001/aulas
curl -X POST http://localhost:3001/cursos -H "Content-Type: application/json" \
  -d '{"titulo":"Panificação Artesanal","categoria":"Pães","nivel":"iniciante","instrutorNome":"Pedro Alves","cargaHorariaHoras":15,"preco":179.9}'

# Matrículas
curl http://localhost:3002/alunos
curl -X POST http://localhost:3002/matriculas -H "Content-Type: application/json" \
  -d '{"alunoId":"30000000-0000-0000-0000-000000000001","cursoId":"10000000-0000-0000-0000-000000000002"}'
curl -X PATCH http://localhost:3002/matriculas/<id>/progresso -H "Content-Type: application/json" \
  -d '{"progressoPercentual":100}'   # marca concluída + emite certificado automaticamente

# Receitas
curl http://localhost:3003/receitas
curl http://localhost:3003/receitas/60000000-0000-0000-0000-000000000001   # já vem com ingredientes
curl http://localhost:3003/ingredientes
```

## Estrutura

```
services/
├── docker-compose.yml
├── db/
│   ├── .env.example
│   └── init/001_seed.sql
├── service_cursos/       (src/index.ts, db.ts, schema.ts, routes.ts)
├── service_matriculas/   (mesma estrutura)
└── service_receitas/     (mesma estrutura)
```
