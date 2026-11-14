import { Hono } from "hono";
import { zValidator as zValidatorBase } from "@hono/zod-validator";
import type { ZodSchema } from "zod";
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { db } from "./db";
import { alunos, matriculas } from "./schema";

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

const statusEnum = z.enum(["ativa", "concluida", "cancelada"]);

const alunoCreateSchema = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const matriculaListQuerySchema = listQuerySchema.extend({
  alunoId: z.string().uuid().optional(),
  cursoId: z.string().uuid().optional(),
});

const matriculaCreateSchema = z.object({
  alunoId: z.string().uuid(),
  cursoId: z.string().uuid(),
});

const progressoUpdateSchema = z.object({
  progressoPercentual: z.number().int().min(0).max(100),
  status: statusEnum.optional(),
  certificadoEmitido: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// /alunos
// ---------------------------------------------------------------------------

routes.get("/alunos", zValidator("query", listQuerySchema), async (c) => {
  const { limit, offset } = c.req.valid("query");
  const resultado = await db.select().from(alunos).orderBy(asc(alunos.id)).limit(limit).offset(offset); // ordem estável para paginar
  return c.json(resultado);
});

routes.get("/alunos/:id", async (c) => {
  const id = c.req.param("id");
  const [aluno] = await db.select().from(alunos).where(eq(alunos.id, id));
  if (!aluno) return notFound(c, "Aluno não encontrado");
  return c.json(aluno);
});

routes.post("/alunos", zValidator("json", alunoCreateSchema), async (c) => {
  const dados = c.req.valid("json");

  const [existente] = await db.select().from(alunos).where(eq(alunos.email, dados.email));
  if (existente) {
    return c.json({ error: "Já existe um aluno cadastrado com este email" }, 409);
  }

  const [criado] = await db.insert(alunos).values(dados).returning();
  return c.json(criado, 201);
});

// ---------------------------------------------------------------------------
// /matriculas
// ---------------------------------------------------------------------------

routes.get("/matriculas", zValidator("query", matriculaListQuerySchema), async (c) => {
  const { alunoId, cursoId, limit, offset } = c.req.valid("query");

  const condicoes = [];
  if (alunoId) condicoes.push(eq(matriculas.alunoId, alunoId));
  if (cursoId) condicoes.push(eq(matriculas.cursoId, cursoId));

  const resultado = await db
    .select()
    .from(matriculas)
    .where(condicoes.length ? and(...condicoes) : undefined)
    .orderBy(asc(matriculas.id)) // ordem estável para paginar
    .limit(limit)
    .offset(offset);

  return c.json(resultado);
});

routes.get("/matriculas/:id", async (c) => {
  const id = c.req.param("id");
  const [matricula] = await db.select().from(matriculas).where(eq(matriculas.id, id));
  if (!matricula) return notFound(c, "Matrícula não encontrada");
  return c.json(matricula);
});

routes.post("/matriculas", zValidator("json", matriculaCreateSchema), async (c) => {
  const dados = c.req.valid("json");

  const [aluno] = await db.select().from(alunos).where(eq(alunos.id, dados.alunoId));
  if (!aluno) return notFound(c, "Aluno não encontrado");

  // Nota: cursoId não é validado contra service_cursos nesta primeira versão
  // (mantido simples de propósito — ver GUIA_LLM.md, seção "O Que NÃO Fazer").

  const [criada] = await db
    .insert(matriculas)
    .values({ alunoId: dados.alunoId, cursoId: dados.cursoId })
    .returning();

  return c.json(criada, 201);
});

routes.patch("/matriculas/:id/progresso", zValidator("json", progressoUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const dados = c.req.valid("json");

  const [existente] = await db.select().from(matriculas).where(eq(matriculas.id, id));
  if (!existente) return notFound(c, "Matrícula não encontrada");

  // Regra de negócio: ao atingir 100%, a matrícula é concluída e o
  // certificado é emitido automaticamente, salvo se o chamador
  // enviar valores explícitos para status/certificadoEmitido.
  const atingiu100 = dados.progressoPercentual === 100;

  const [atualizada] = await db
    .update(matriculas)
    .set({
      progressoPercentual: dados.progressoPercentual,
      status: dados.status ?? (atingiu100 ? "concluida" : existente.status),
      certificadoEmitido: dados.certificadoEmitido ?? (atingiu100 ? true : existente.certificadoEmitido),
    })
    .where(eq(matriculas.id, id))
    .returning();

  return c.json(atualizada);
});
