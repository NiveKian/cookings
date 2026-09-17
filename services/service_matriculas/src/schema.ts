import { pgSchema, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// Este serviço só declara e acessa o schema "matriculas" do Postgres.
// curso_id é uma referência LÓGICA a cursos.cursos.id (schema "cursos"),
// sem FOREIGN KEY entre schemas — ver GUIA_LLM.md, seção 7.
export const matriculasSchema = pgSchema("matriculas");

export const alunos = matriculasSchema.table("alunos", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const matriculas = matriculasSchema.table("matriculas", {
  id: uuid("id").primaryKey().defaultRandom(),
  alunoId: uuid("aluno_id").notNull().references(() => alunos.id, { onDelete: "cascade" }),
  cursoId: uuid("curso_id").notNull(), // referência lógica, sem FK
  dataMatricula: timestamp("data_matricula").notNull().defaultNow(),
  progressoPercentual: integer("progresso_percentual").notNull().default(0),
  status: text("status").notNull().default("ativa"), // 'ativa' | 'concluida' | 'cancelada'
  certificadoEmitido: boolean("certificado_emitido").notNull().default(false),
});
