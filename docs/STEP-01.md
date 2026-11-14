# STEP 1 — Schema e seed (`services/db`)

Prepara o banco para as features de alérgenos, receitas geradas por IA e substituições. **Só mexe em `services/`**; nenhuma linha de código de `services/service_*`, `mcp/` ou `app/` muda neste step (isso começa no Step 2).

## Arquivos alterados

| Ação | Arquivo |
|---|---|
| Substituir inteiro | `services/db/init/001_seed.sql` |
| Editar (2 trechos) | `services/README.md` |

## O que mudou no schema

| Tabela | Mudança |
|---|---|
| `receitas.ingredientes` | Nova coluna `alergenos TEXT[] NOT NULL DEFAULT '{}'`, com `CHECK` que só aceita o vocabulário fixo: `gluten`, `lactose`, `ovo`, `soja`, `amendoim`, `castanhas`, `peixe`, `crustaceos` (minúsculo, sem acento) |
| `receitas.receitas` | `curso_id` passa a aceitar `NULL`; nova coluna `origem TEXT NOT NULL DEFAULT 'curso'` (`'curso'` ou `'ia'`); nova regra `receitas_origem_curso_chk`: receita de origem `curso` **exige** `curso_id` (só receita `ia` pode ficar sem curso) |
| `receitas.substituicoes` (**nova**) | `id`, `ingrediente_id` (FK com `ON DELETE CASCADE`), `substituto` (texto livre), `observacao`; índice em `ingrediente_id` |

**Dados de exemplo:**
- Alérgenos nos 12 ingredientes existentes: Farinha de trigo = `gluten`, Ovos = `ovo`, Manteiga = `lactose`, Leite = `lactose`; os demais ficam vazios.
- 5 substituições (manteiga, leite, ovos, farinha de trigo, manjericão), com IDs fixos no padrão `70000000-0000-0000-0000-00000000000N` (prefixo `7000…` para substituições, junto dos já existentes `1000…` a `6000…`).

**Efeito sobre o código atual:** nenhum. Os `service_*` continuam funcionando sem alteração (novas colunas têm default; os services de hoje sempre enviam `cursoId`). Os novos campos **ainda não aparecem nas APIs** (isso é o Step 2).

## ⚠️ Como aplicar (obrigatório: reset do banco)

O Postgres só roda `db/init/*.sql` quando o volume está **vazio**. Como o seed mudou, é preciso recriar o volume:

```bash
cd services
docker compose down -v        # apaga o volume: TODOS os dados do banco, inclusive o que foi criado em uso
docker compose up -d --build
```

`mcp/` e `app/` não precisam de rebuild neste step. Se estiverem no ar, continuam funcionando; só reinicie se perderem a conexão.

---

## 1. `services/db/init/001_seed.sql` (substituir o arquivo inteiro)

```sql
-- ============================================================
-- Cookings — Seed inicial do banco de dados
-- Executado automaticamente pelo Postgres apenas na primeira
-- inicialização do volume (via /docker-entrypoint-initdb.d).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- necessário para gen_random_uuid()

CREATE SCHEMA IF NOT EXISTS cursos;
CREATE SCHEMA IF NOT EXISTS matriculas;
CREATE SCHEMA IF NOT EXISTS receitas;

-- ============================================================
-- SCHEMA: cursos  (dono: service_cursos)
-- ============================================================

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

-- ============================================================
-- SCHEMA: matriculas  (dono: service_matriculas)
-- ============================================================

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

-- ============================================================
-- SCHEMA: receitas  (dono: service_receitas)
-- ============================================================

CREATE TABLE receitas.ingredientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  unidade_padrao TEXT NOT NULL,
  -- Alérgenos presentes no ingrediente. Vocabulário FIXO (minúsculo, sem acento).
  -- Para aceitar um alérgeno novo, ajuste esta constraint (ALTER TABLE ... DROP/ADD CONSTRAINT).
  alergenos TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT ingredientes_alergenos_vocab_chk CHECK (
    alergenos <@ ARRAY['gluten','lactose','ovo','soja','amendoim','castanhas','peixe','crustaceos']::TEXT[]
  )
);

CREATE TABLE receitas.receitas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id UUID,                -- referência lógica a cursos.cursos.id (sem FK); opcional para receitas geradas por IA
  aula_id UUID,                 -- referência lógica a cursos.aulas.id (sem FK), opcional
  nome TEXT NOT NULL,
  modo_preparo TEXT NOT NULL,
  tempo_preparo_minutos INT NOT NULL,
  porcoes INT NOT NULL DEFAULT 1,
  -- 'curso' = receita ensinada em um curso da plataforma; 'ia' = receita inventada pelo assistente.
  origem TEXT NOT NULL DEFAULT 'curso' CHECK (origem IN ('curso', 'ia')),
  -- Receita de curso sempre pertence a um curso; só receita 'ia' pode ficar sem curso.
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

-- Substituições conhecidas de um ingrediente do catálogo (ex.: manteiga -> margarina sem lactose).
-- "substituto" é texto livre: nem todo substituto precisa existir no catálogo de ingredientes.
CREATE TABLE receitas.substituicoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingrediente_id UUID NOT NULL REFERENCES receitas.ingredientes(id) ON DELETE CASCADE,
  substituto TEXT NOT NULL,
  observacao TEXT
);

CREATE INDEX substituicoes_ingrediente_id_idx ON receitas.substituicoes (ingrediente_id);

-- ============================================================
-- DADOS DE EXEMPLO
-- IDs fixos (literais) para facilitar testes manuais e nos
-- servidores MCP. Em produção real, os IDs seriam gerados
-- automaticamente via gen_random_uuid().
-- ============================================================

-- ---------- cursos.cursos ----------
INSERT INTO cursos.cursos (id, titulo, descricao, categoria, nivel, instrutor_nome, carga_horaria_horas, preco) VALUES
('10000000-0000-0000-0000-000000000001', 'Fundamentos da Culinária Italiana', 'Aprenda a fazer massas frescas, molhos clássicos e pratos tradicionais da Itália.', 'Massas', 'iniciante', 'Marco Rossi', 20, 199.90),
('10000000-0000-0000-0000-000000000002', 'Confeitaria Francesa Essencial', 'Técnicas de massas folhadas, croissants e sobremesas clássicas francesas.', 'Confeitaria', 'intermediario', 'Claire Dubois', 30, 349.90),
('10000000-0000-0000-0000-000000000003', 'Churrasco e Grelhados', 'Cortes de carne, técnicas de grelha e pontos de cozimento ideais.', 'Carnes', 'iniciante', 'João Silva', 12, 149.90);

-- ---------- cursos.aulas ----------
INSERT INTO cursos.aulas (id, curso_id, titulo, ordem, duracao_minutos) VALUES
('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Introdução às massas frescas', 1, 45),
('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Molhos clássicos italianos', 2, 50),
('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Massa ao sugo na prática', 3, 60),

('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Massas folhadas', 1, 55),
('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'Croissants e viennoiserie', 2, 70),

('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000003', 'Cortes de carne e preparo', 1, 40),
('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000003', 'Técnicas de grelha', 2, 50);

-- ---------- matriculas.alunos ----------
INSERT INTO matriculas.alunos (id, nome, email) VALUES
('30000000-0000-0000-0000-000000000001', 'Ana Souza', 'ana.souza@example.com'),
('30000000-0000-0000-0000-000000000002', 'Bruno Lima', 'bruno.lima@example.com'),
('30000000-0000-0000-0000-000000000003', 'Carla Mendes', 'carla.mendes@example.com');

-- ---------- matriculas.matriculas ----------
-- curso_id referencia cursos.cursos.id (sem FK entre schemas)
INSERT INTO matriculas.matriculas (id, aluno_id, curso_id, progresso_percentual, status, certificado_emitido) VALUES
('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 60, 'ativa', false),
('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 100, 'concluida', true),
('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 20, 'ativa', false),
('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 0, 'ativa', false);

-- ---------- receitas.ingredientes ----------
INSERT INTO receitas.ingredientes (id, nome, unidade_padrao, alergenos) VALUES
('50000000-0000-0000-0000-000000000001', 'Farinha de trigo', 'g', '{gluten}'),
('50000000-0000-0000-0000-000000000002', 'Ovos', 'unidade', '{ovo}'),
('50000000-0000-0000-0000-000000000003', 'Manteiga', 'g', '{lactose}'),
('50000000-0000-0000-0000-000000000004', 'Açúcar', 'g', '{}'),
('50000000-0000-0000-0000-000000000005', 'Leite', 'ml', '{lactose}'),
('50000000-0000-0000-0000-000000000006', 'Sal', 'g', '{}'),
('50000000-0000-0000-0000-000000000007', 'Tomate', 'g', '{}'),
('50000000-0000-0000-0000-000000000008', 'Manjericão', 'g', '{}'),
('50000000-0000-0000-0000-000000000009', 'Alho', 'unidade', '{}'),
('50000000-0000-0000-0000-000000000010', 'Azeite de oliva', 'ml', '{}'),
('50000000-0000-0000-0000-000000000011', 'Fermento biológico', 'g', '{}'),
('50000000-0000-0000-0000-000000000012', 'Costela bovina', 'kg', '{}');

-- ---------- receitas.receitas ----------
-- curso_id / aula_id referenciam cursos.cursos.id / cursos.aulas.id (sem FK entre schemas)
INSERT INTO receitas.receitas (id, curso_id, aula_id, nome, modo_preparo, tempo_preparo_minutos, porcoes) VALUES
('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003',
  'Massa fresca ao sugo',
  'Prepare a massa fresca com farinha e ovos, descanse por 30 minutos e abra fina. Cozinhe o molho de tomate com alho e azeite, finalize com manjericão fresco. Cozinhe a massa em água salada e misture ao molho.',
  60, 4),
('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005',
  'Croissant clássico',
  'Prepare a massa laminada intercalando camadas de manteiga e massa levedada. Deixe fermentar, modele os croissants, pincele com ovo e asse até dourar.',
  180, 8),
('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000007',
  'Costela ao ponto na grelha',
  'Tempere a costela com sal grosso e alho, leve à grelha em fogo indireto por tempo prolongado até atingir o ponto desejado. Deixe descansar antes de servir.',
  240, 6);

-- ---------- receitas.receita_ingredientes ----------
INSERT INTO receitas.receita_ingredientes (receita_id, ingrediente_id, quantidade, unidade, observacao) VALUES
-- Massa fresca ao sugo
('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 300, 'g', NULL),
('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 3, 'unidade', NULL),
('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000006', 5, 'g', NULL),
('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000007', 400, 'g', NULL),
('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000008', 10, 'g', 'Pode substituir por manjericão seco se o fresco não estiver disponível'),
('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000009', 2, 'unidade', NULL),
('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000010', 30, 'ml', NULL),

-- Croissant clássico
('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 500, 'g', NULL),
('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', 400, 'g', 'Contém laticínios — atenção para alunos com restrição'),
('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000004', 50, 'g', NULL),
('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000005', 100, 'ml', NULL),
('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000011', 10, 'g', NULL),
('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 1, 'unidade', 'Usado apenas para pincelar antes de assar'),

-- Costela ao ponto na grelha
('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000012', 2, 'kg', NULL),
('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000006', 20, 'g', NULL),
('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000009', 4, 'unidade', NULL);

-- ---------- receitas.substituicoes ----------
INSERT INTO receitas.substituicoes (id, ingrediente_id, substituto, observacao) VALUES
('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'Margarina sem lactose', 'Mesma quantidade. Confira o rótulo: algumas margarinas contêm leite.'),
('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000005', 'Bebida vegetal (aveia, soja ou amêndoa)', 'Mesma quantidade. Soja e amêndoa são alérgenos: confira as restrições de quem vai comer.'),
('70000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 'Purê de maçã sem açúcar', 'Cerca de 60 g por ovo. Funciona em bolos e massas macias; não serve para preparos que dependem de claras em neve.'),
('70000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001', 'Mix de farinhas sem glúten', 'Em partes iguais, seguindo o rótulo do mix. A textura muda, principalmente em massas folhadas.'),
('70000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000008', 'Manjericão seco', 'Cerca de um terço da quantidade do fresco.');
```

## 2. `services/README.md`

**Trecho A.** Localize a linha:

```diff
-Na primeira subida, o Postgres executa automaticamente `db/init/001_seed.sql`, criando os 3 schemas, as 7 tabelas e os dados de exemplo.
+Na primeira subida, o Postgres executa automaticamente `db/init/001_seed.sql`, criando os 3 schemas, as 8 tabelas e os dados de exemplo.
```

**Trecho B.** Logo abaixo dessa linha (antes de `## Como Rodar (sem Docker, ...)`), acrescente:

````markdown
### Resetar o banco (obrigatório sempre que o `001_seed.sql` mudar)

O Postgres só executa os scripts de `db/init/` quando o volume de dados está **vazio**. Se você alterar o seed (ou o schema), a mudança **não** é reaplicada sozinha. Para recriar o banco do zero:

```bash
cd services
docker compose down -v        # -v apaga o volume: TODOS os dados do banco, inclusive o que foi criado em uso
docker compose up -d --build
```
````

---

## Como conferir depois do reset

```bash
docker exec -it cookings_db psql -U cookings -d cookings -c "select nome, alergenos from receitas.ingredientes;"
docker exec -it cookings_db psql -U cookings -d cookings -c "select count(*) from receitas.substituicoes;"   # 5
curl http://localhost:3003/receitas                                                                          # 3 receitas, como antes
```

(Ajuste `-U` e `-d` se você mudou `POSTGRES_USER`/`POSTGRES_DB` em `services/db/.env`.)

## Validação

**Validado (no meu ambiente, com PostgreSQL 16 real):**
- O seed novo roda **do zero sem erros** (`ON_ERROR_STOP`), e as contagens batem: 3 cursos, 7 aulas, 3 alunos, 4 matrículas, 12 ingredientes, 3 receitas, 16 vínculos receita-ingrediente, 5 substituições.
- Constraints testadas, todas se comportando como esperado:
  - **aceita:** alérgeno válido, ingrediente sem alérgenos (usa `{}`), receita `ia` sem curso, receita com curso e sem `origem` (como os services fazem hoje);
  - **recusa:** alérgeno fora do vocabulário, alérgeno com maiúscula, receita `curso` sem curso, receita sem `origem` e sem curso, `origem` inválida, substituição de ingrediente inexistente;
  - **integridade:** apagar um ingrediente remove suas substituições (CASCADE); apagar um ingrediente em uso numa receita continua bloqueado (RESTRICT, como já era).
- **Sem regressão:** os 3 `service_*` do seu repositório, sem nenhuma alteração, rodando contra o schema novo: `GET` de cursos, alunos, receitas e ingredientes, filtro `?cursoId=`, detalhe da receita com 7 ingredientes, e `POST` de ingrediente, receita e vínculo, todos com o resultado esperado.

**Não validado:**
- A subida pelo Docker (`down -v` + `up`). Usei o Postgres 16 e criei o usuário `cookings` como superusuário, que é o que a imagem oficial faz com `POSTGRES_USER`, mas o ciclo do container em si é com você.
- O seed com fim de linha CRLF no Windows: o `.gitattributes` do Step 0 grava os arquivos com LF, e `psql` aceita CRLF em SQL simples (como o seed anterior já rodava no seu Docker).

## Observações

- O catálogo tem só 12 ingredientes. Para o Step 3 (busca por ingredientes) e para a geração de receitas funciona, mas fica pequeno para demonstrar (por exemplo, não há chocolate nem creme de leite). Se quiser, enriqueço o catálogo no seed em um step opcional.
- Se um dia precisar de um alérgeno novo, é preciso trocar a constraint `ingredientes_alergenos_vocab_chk` (`ALTER TABLE ... DROP CONSTRAINT` + `ADD CONSTRAINT`) e, no seed, atualizar a lista.
