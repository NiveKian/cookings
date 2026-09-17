import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routes } from "./routes";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok", service: "service_cursos" }));

app.route("/", routes);

app.notFound((c) => c.json({ error: "Rota não encontrada" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  // Erros de validação do @hono/zod-validator chegam aqui com status 400 já setado
  const status = (err as any).status ?? 500;

  if (status === 400) {
    return c.json({ error: "Dados inválidos", details: (err as any).cause ?? err.message }, 400);
  }

  console.error("[service_cursos] Erro interno:", err);
  return c.json({ error: "Erro interno do servidor" }, 500);
});

const port = Number(process.env.PORT ?? 3001);

console.log(`[service_cursos] rodando na porta ${port}`);

export default {
  port,
  fetch: app.fetch,
};
