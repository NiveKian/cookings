import { Hono } from "hono";
import { zValidator as zValidatorBase } from "@hono/zod-validator";
import type { ZodSchema } from "zod";
import { z } from "zod";
import { eq, and, asc, desc } from "drizzle-orm";
import { db } from "./db";
import { cursos, aulas } from "./schema";

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

// ---------------------------------------------------------------------------
// Schemas de validação (Zod)
// ---------------------------------------------------------------------------

const nivelEnum = z.enum(["iniciante", "intermediario", "avancado"]);

const cursoCreateSchema = z.object({
  titulo: z.string().min(1),
  descricao: z.string().optional(),
  categoria: z.string().min(1),
  nivel: nivelEnum,
  instrutorNome: z.string().min(1),
  cargaHorariaHoras: z.number().int().positive(),
  preco: z.number().nonnegative().default(0),
});

const cursoUpdateSchema = cursoCreateSchema.partial();

const cursoListQuerySchema = z.object({
  categoria: z.string().optional(),
  nivel: nivelEnum.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const aulaCreateSchema = z.object({
  titulo: z.string().min(1),
  ordem: z.number().int().nonnegative(),
  duracaoMinutos: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notFound(c: any, mensagem: string) {
  return c.json({ error: mensagem }, 404);
}

// ---------------------------------------------------------------------------
// /cursos
// ---------------------------------------------------------------------------

routes.get("/cursos", zValidator("query", cursoListQuerySchema), async (c) => {
  const { categoria, nivel, limit, offset } = c.req.valid("query");

  const condicoes = [];
  if (categoria) condicoes.push(eq(cursos.categoria, categoria));
  if (nivel) condicoes.push(eq(cursos.nivel, nivel));

  const resultado = await db
    .select()
    .from(cursos)
    .where(condicoes.length ? and(...condicoes) : undefined)
    .orderBy(desc(cursos.criadoEm))
    .limit(limit)
    .offset(offset);

  return c.json(resultado);
});

routes.get("/cursos/:id", async (c) => {
  const id = c.req.param("id");
  const [curso] = await db.select().from(cursos).where(eq(cursos.id, id));
  if (!curso) return notFound(c, "Curso não encontrado");
  return c.json(curso);
});

routes.post("/cursos", zValidator("json", cursoCreateSchema), async (c) => {
  const dados = c.req.valid("json");
  const [criado] = await db
    .insert(cursos)
    .values({
      titulo: dados.titulo,
      descricao: dados.descricao,
      categoria: dados.categoria,
      nivel: dados.nivel,
      instrutorNome: dados.instrutorNome,
      cargaHorariaHoras: dados.cargaHorariaHoras,
      preco: dados.preco.toString(),
    })
    .returning();
  return c.json(criado, 201);
});

routes.put("/cursos/:id", zValidator("json", cursoUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const dados = c.req.valid("json");

  const [existente] = await db.select().from(cursos).where(eq(cursos.id, id));
  if (!existente) return notFound(c, "Curso não encontrado");

  const [atualizado] = await db
    .update(cursos)
    .set({
      ...dados,
      preco: dados.preco !== undefined ? dados.preco.toString() : undefined,
    })
    .where(eq(cursos.id, id))
    .returning();

  return c.json(atualizado);
});

routes.delete("/cursos/:id", async (c) => {
  const id = c.req.param("id");
  const [existente] = await db.select().from(cursos).where(eq(cursos.id, id));
  if (!existente) return notFound(c, "Curso não encontrado");

  await db.delete(cursos).where(eq(cursos.id, id));
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// /cursos/:id/aulas
// ---------------------------------------------------------------------------

routes.get("/cursos/:id/aulas", async (c) => {
  const cursoId = c.req.param("id");

  const [curso] = await db.select().from(cursos).where(eq(cursos.id, cursoId));
  if (!curso) return notFound(c, "Curso não encontrado");

  const resultado = await db
    .select()
    .from(aulas)
    .where(eq(aulas.cursoId, cursoId))
    .orderBy(asc(aulas.ordem));

  return c.json(resultado);
});

routes.post("/cursos/:id/aulas", zValidator("json", aulaCreateSchema), async (c) => {
  const cursoId = c.req.param("id");
  const dados = c.req.valid("json");

  const [curso] = await db.select().from(cursos).where(eq(cursos.id, cursoId));
  if (!curso) return notFound(c, "Curso não encontrado");

  const [criada] = await db
    .insert(aulas)
    .values({
      cursoId,
      titulo: dados.titulo,
      ordem: dados.ordem,
      duracaoMinutos: dados.duracaoMinutos,
    })
    .returning();

  return c.json(criada, 201);
});
