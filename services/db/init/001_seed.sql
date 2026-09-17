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
  unidade_padrao TEXT NOT NULL
);

CREATE TABLE receitas.receitas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id UUID NOT NULL,       -- referência lógica a cursos.cursos.id (sem FK)
  aula_id UUID,                 -- referência lógica a cursos.aulas.id (sem FK), opcional
  nome TEXT NOT NULL,
  modo_preparo TEXT NOT NULL,
  tempo_preparo_minutos INT NOT NULL,
  porcoes INT NOT NULL DEFAULT 1
);

CREATE TABLE receitas.receita_ingredientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receita_id UUID NOT NULL REFERENCES receitas.receitas(id) ON DELETE CASCADE,
  ingrediente_id UUID NOT NULL REFERENCES receitas.ingredientes(id) ON DELETE RESTRICT,
  quantidade NUMERIC(10,2) NOT NULL,
  unidade TEXT NOT NULL,
  observacao TEXT
);

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
INSERT INTO receitas.ingredientes (id, nome, unidade_padrao) VALUES
('50000000-0000-0000-0000-000000000001', 'Farinha de trigo', 'g'),
('50000000-0000-0000-0000-000000000002', 'Ovos', 'unidade'),
('50000000-0000-0000-0000-000000000003', 'Manteiga', 'g'),
('50000000-0000-0000-0000-000000000004', 'Açúcar', 'g'),
('50000000-0000-0000-0000-000000000005', 'Leite', 'ml'),
('50000000-0000-0000-0000-000000000006', 'Sal', 'g'),
('50000000-0000-0000-0000-000000000007', 'Tomate', 'g'),
('50000000-0000-0000-0000-000000000008', 'Manjericão', 'g'),
('50000000-0000-0000-0000-000000000009', 'Alho', 'unidade'),
('50000000-0000-0000-0000-000000000010', 'Azeite de oliva', 'ml'),
('50000000-0000-0000-0000-000000000011', 'Fermento biológico', 'g'),
('50000000-0000-0000-0000-000000000012', 'Costela bovina', 'kg');

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
