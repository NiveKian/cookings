import { Hono } from "hono";
import { zValidator as zValidatorBase } from "@hono/zod-validator";
import type { ZodSchema } from "zod";
import { z } from "zod";
import { eq, and, asc, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { ingredientes, receitas, receitaIngredientes, substituicoes } from "./schema";
import { ACENTOS_DE, ACENTOS_PARA, montarListaDeNomes, semAcento } from "./texto";

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

// Vocabulário fixo de alérgenos (minúsculo). Igual ao CHECK do SQL.
const ALERGENOS = ["gluten", "lactose", "ovo", "soja", "amendoim", "castanhas", "peixe", "crustaceos"] as const;

const receitaListQuerySchema = listQuerySchema.extend({
  cursoId: z.string().uuid().optional(),
  aulaId: z.string().uuid().optional(),
  // Nomes de ingredientes: parâmetro repetido (?ingrediente=a&ingrediente=b)
  // e/ou separado por vírgula (?ingrediente=a,b).
  ingrediente: z.union([z.string(), z.array(z.string())]).optional(),
  modo: z.enum(["todos", "qualquer"]).default("qualquer"),
  // Trecho do nome da receita (sem acento/caixa).
  nome: z.string().min(1).optional(),
});

const receitaCreateSchema = z
  .object({
    cursoId: z.string().uuid().optional(),
    aulaId: z.string().uuid().optional(),
    nome: z.string().min(1),
    modoPreparo: z.string().min(1),
    tempoPreparoMinutos: z.number().int().positive(),
    porcoes: z.number().int().positive().default(1),
    origem: z.enum(["curso", "ia"]).default("curso"),
  })
  .refine((d) => d.origem !== "curso" || d.cursoId !== undefined, {
    message: "cursoId é obrigatório quando origem é 'curso'",
    path: ["cursoId"],
  });

const ingredienteCreateSchema = z.object({
  nome: z.string().min(1),
  unidadePadrao: z.string().min(1),
  alergenos: z.array(z.enum(ALERGENOS)).default([]),
});

const idParamSchema = z.object({ id: z.string().uuid() });

// Expressão SQL: nome do ingrediente sem acento e em minúsculo
// (sem a extensão unaccent, que pode faltar na imagem alpine).
const nomeNormalizado = sql`lower(translate(${ingredientes.nome}, ${sql.raw(`'${ACENTOS_DE}'`)}, ${sql.raw(`'${ACENTOS_PARA}'`)}))`;

// Mesma ideia para o nome da receita (filtro `nome`).
const nomeReceitaNormalizado = sql`lower(translate(${receitas.nome}, ${sql.raw(`'${ACENTOS_DE}'`)}, ${sql.raw(`'${ACENTOS_PARA}'`)}))`;

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
  const resultado = await db.select().from(ingredientes).orderBy(asc(ingredientes.id)).limit(limit).offset(offset);
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

// Substituições conhecidas de um ingrediente (lista vazia se não houver).
routes.get("/ingredientes/:id/substituicoes", zValidator("param", idParamSchema), async (c) => {
  const { id } = c.req.valid("param");

  const [ingrediente] = await db.select().from(ingredientes).where(eq(ingredientes.id, id));
  if (!ingrediente) return notFound(c, "Ingrediente não encontrado no catálogo");

  const resultado = await db.select().from(substituicoes).where(eq(substituicoes.ingredienteId, id));
  return c.json(resultado);
});

// ---------------------------------------------------------------------------
// /receitas
// ---------------------------------------------------------------------------

routes.get("/receitas", zValidator("query", receitaListQuerySchema), async (c) => {
  const { cursoId, aulaId, ingrediente, modo, nome, limit, offset } = c.req.valid("query");

  const condicoes = [];
  if (cursoId) condicoes.push(eq(receitas.cursoId, cursoId));
  if (aulaId) condicoes.push(eq(receitas.aulaId, aulaId));

  // Filtro por trecho do nome: escapa \, % e _ para valerem como texto literal.
  if (nome) {
    const termo = semAcento(nome.trim()).replace(/[\\%_]/g, "\\$&");
    if (termo) condicoes.push(sql`${nomeReceitaNormalizado} like ${`%${termo}%`}`);
  }

  // Filtro por ingredientes (sem acento/caixa). Sem nomes, `modo` é ignorado.
  // "qualquer": receita com ao menos um dos nomes; "todos": com todos eles.
  const nomes = montarListaDeNomes(ingrediente);
  if (nomes.length > 0) {
    const receitasComIngredientes = db
      .select({ id: receitaIngredientes.receitaId })
      .from(receitaIngredientes)
      .innerJoin(ingredientes, eq(receitaIngredientes.ingredienteId, ingredientes.id))
      .where(inArray(nomeNormalizado, nomes))
      .groupBy(receitaIngredientes.receitaId)
      .having(modo === "todos" ? sql`count(distinct ${nomeNormalizado}) = ${nomes.length}` : undefined);
    condicoes.push(inArray(receitas.id, receitasComIngredientes));
  }

  const resultado = await db
    .select()
    .from(receitas)
    .where(condicoes.length ? and(...condicoes) : undefined)
    .orderBy(asc(receitas.id)) // ordem estável para paginar
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
      alergenos: ingredientes.alergenos,
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
      .values({ receitaId, ...dados, quantidade: String(dados.quantidade) }) // NUMERIC no Drizzle é string
      .returning();

    return c.json(criado, 201);
  }
);
