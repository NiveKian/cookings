import { sql } from "drizzle-orm";
import { pgSchema, uuid, text, integer, numeric } from "drizzle-orm/pg-core";

// Este serviço só declara e acessa o schema "receitas" do Postgres.
// curso_id / aula_id são referências LÓGICAS a cursos.cursos.id / cursos.aulas.id
// (schema "cursos"), sem FOREIGN KEY entre schemas — ver GUIA_LLM.md, seção 7.
export const receitasSchema = pgSchema("receitas");

export const ingredientes = receitasSchema.table("ingredientes", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull().unique(),
  unidadePadrao: text("unidade_padrao").notNull(),
  // Vocabulário fixo e minúsculo (o CHECK fica no SQL): gluten, lactose, ovo,
  // soja, amendoim, castanhas, peixe, crustaceos.
  alergenos: text("alergenos").array().notNull().default(sql`'{}'::text[]`),
});

export const receitas = receitasSchema.table("receitas", {
  id: uuid("id").primaryKey().defaultRandom(),
  cursoId: uuid("curso_id"), // referência lógica, sem FK; nulo só quando origem = 'ia'
  aulaId: uuid("aula_id"), // referência lógica, sem FK, opcional
  nome: text("nome").notNull(),
  modoPreparo: text("modo_preparo").notNull(),
  tempoPreparoMinutos: integer("tempo_preparo_minutos").notNull(),
  porcoes: integer("porcoes").notNull().default(1),
  origem: text("origem").notNull().default("curso"), // 'curso' | 'ia' (CHECK no SQL)
});

export const receitaIngredientes = receitasSchema.table("receita_ingredientes", {
  id: uuid("id").primaryKey().defaultRandom(),
  receitaId: uuid("receita_id")
    .notNull()
    .references(() => receitas.id, { onDelete: "cascade" }),
  ingredienteId: uuid("ingrediente_id")
    .notNull()
    .references(() => ingredientes.id, { onDelete: "restrict" }),
  quantidade: numeric("quantidade", { precision: 10, scale: 2 }).notNull(),
  unidade: text("unidade").notNull(),
  observacao: text("observacao"),
});

// Substituições conhecidas de um ingrediente do catálogo.
// "substituto" é texto livre (nem todo substituto existe no catálogo).
export const substituicoes = receitasSchema.table("substituicoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  ingredienteId: uuid("ingrediente_id")
    .notNull()
    .references(() => ingredientes.id, { onDelete: "cascade" }),
  substituto: text("substituto").notNull(),
  observacao: text("observacao"),
});
