import { Hono } from "hono";
import { zValidator as zValidatorBase } from "@hono/zod-validator";
import type { ZodSchema } from "zod";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "./db";
import { ingredientes, receitas, receitaIngredientes } from "./schema";

export const routes = new Hono();

// Wrapper do zValidator que padroniza o formato de erro de validação
// em { error, details } (400), em vez do formato padrão da lib.
function zValidator<T extends ZodSchema, Target extends "json" | "query" | "param">(
  target: Target,
  schema: T
) {
  return zValidatorBase(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Dados inválidos", details: result.error.issues }, 400);
    }
  });
}

function notFound(c: any, mensagem: string) {
  return c.json({ error: mensagem }, 404);
}

// ---------------------------------------------------------------------------
// Schemas de validação (Zod)
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const receitaListQuerySchema = listQuerySchema.extend({
  cursoId: z.string().uuid().optional(),
  aulaId: z.string().uuid().optional(),
});

const receitaCreateSchema = z.object({
  cursoId: z.string().uuid(),
  aulaId: z.string().uuid().optional(),
  nome: z.string().min(1),
  modoPreparo: z.string().min(1),
  tempoPreparoMinutos: z.number().int().positive(),
  porcoes: z.number().int().positive().default(1),
});

const ingredienteCreateSchema = z.object({
  nome: z.string().min(1),
  unidadePadrao: z.string().min(1),
});

const receitaIngredienteCreateSchema = z.object({
  ingredienteId: z.string().uuid(),
  quantidade: z.number().positive(),
  unidade: z.string().min(1),
  observacao: z.string().optional(),
});

// ---------------------------------------------------------------------------
// /ingredientes (catálogo compartilhado)
// ---------------------------------------------------------------------------

routes.get("/ingredientes", zValidator("query", listQuerySchema), async (c) => {
  const { limit, offset } = c.req.valid("query");
  const resultado = await db.select().from(ingredientes).limit(limit).offset(offset);
  return c.json(resultado);
});

routes.post("/ingredientes", zValidator("json", ingredienteCreateSchema), async (c) => {
  const dados = c.req.valid("json");

  const [existente] = await db.select().from(ingredientes).where(eq(ingredientes.nome, dados.nome));
  if (existente) {
    return c.json({ error: "Já existe um ingrediente com este nome no catálogo" }, 409);
  }

  const [criado] = await db.insert(ingredientes).values(dados).returning();
  return c.json(criado, 201);
});

// ---------------------------------------------------------------------------
// /receitas
// ---------------------------------------------------------------------------

routes.get("/receitas", zValidator("query", receitaListQuerySchema), async (c) => {
  const { cursoId, aulaId, limit, offset } = c.req.valid("query");

  const condicoes = [];
  if (cursoId) condicoes.push(eq(receitas.cursoId, cursoId));
  if (aulaId) condicoes.push(eq(receitas.aulaId, aulaId));

  const resultado = await db
    .select()
    .from(receitas)
    .where(condicoes.length ? and(...condicoes) : undefined)
    .limit(limit)
    .offset(offset);

  return c.json(resultado);
});

routes.get("/receitas/:id", async (c) => {
  const id = c.req.param("id");

  const [receita] = await db.select().from(receitas).where(eq(receitas.id, id));
  if (!receita) return notFound(c, "Receita não encontrada");

  const ingredientesDaReceita = await db
    .select({
      ingredienteId: receitaIngredientes.ingredienteId,
      nome: ingredientes.nome,
      unidadePadrao: ingredientes.unidadePadrao,
      quantidade: receitaIngredientes.quantidade,
      unidade: receitaIngredientes.unidade,
      observacao: receitaIngredientes.observacao,
    })
    .from(receitaIngredientes)
    .innerJoin(ingredientes, eq(receitaIngredientes.ingredienteId, ingredientes.id))
    .where(eq(receitaIngredientes.receitaId, id));

  return c.json({ ...receita, ingredientes: ingredientesDaReceita });
});

routes.post("/receitas", zValidator("json", receitaCreateSchema), async (c) => {
  const dados = c.req.valid("json");
  const [criada] = await db.insert(receitas).values(dados).returning();
  return c.json(criada, 201);
});

// ---------------------------------------------------------------------------
// /receitas/:id/ingredientes
// ---------------------------------------------------------------------------

routes.post(
  "/receitas/:id/ingredientes",
  zValidator("json", receitaIngredienteCreateSchema),
  async (c) => {
    const receitaId = c.req.param("id");
    const dados = c.req.valid("json");

    const [receita] = await db.select().from(receitas).where(eq(receitas.id, receitaId));
    if (!receita) return notFound(c, "Receita não encontrada");

    const [ingrediente] = await db
      .select()
      .from(ingredientes)
      .where(eq(ingredientes.id, dados.ingredienteId));
    if (!ingrediente) return notFound(c, "Ingrediente não encontrado no catálogo");

    const [criado] = await db
      .insert(receitaIngredientes)
      .values({ receitaId, ...dados })
      .returning();

    return c.json(criado, 201);
  }
);
