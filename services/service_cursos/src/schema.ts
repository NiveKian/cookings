import { pgSchema, uuid, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";

// Este serviço só declara e acessa o schema "cursos" do Postgres.
// Nenhuma tabela de outro domínio (matriculas, receitas) é declarada aqui.
export const cursosSchema = pgSchema("cursos");

export const cursos = cursosSchema.table("cursos", {
  id: uuid("id").primaryKey().defaultRandom(),
  titulo: text("titulo").notNull(),
  descricao: text("descricao"),
  categoria: text("categoria").notNull(),
  nivel: text("nivel").notNull(), // 'iniciante' | 'intermediario' | 'avancado'
  instrutorNome: text("instrutor_nome").notNull(),
  cargaHorariaHoras: integer("carga_horaria_horas").notNull(),
  preco: numeric("preco", { precision: 10, scale: 2 }).notNull().default("0"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const aulas = cursosSchema.table("aulas", {
  id: uuid("id").primaryKey().defaultRandom(),
  cursoId: uuid("curso_id").notNull().references(() => cursos.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  ordem: integer("ordem").notNull(),
  duracaoMinutos: integer("duracao_minutos").notNull(),
});
