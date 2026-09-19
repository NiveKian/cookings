import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { z } from "zod";
import { sendChatMessage } from "./src/application/chat/sendChatMessage";
import { createLLMAdapter } from "./src/infrastructure/llm/llmFactory";
import { McpToolsAdapter } from "./src/infrastructure/mcp/McpToolsAdapter";

const app = new Hono();

app.use("*", cors());

// -----------------------------------------------------------------------
// Dependências (hexagonal: trocar de provedor de IA = trocar só aqui)
// -----------------------------------------------------------------------

const llm = createLLMAdapter();

const mcpTools = new McpToolsAdapter([
  { name: "cursos", url: process.env.MCP_CURSOS_URL || "http://localhost:8001/mcp" },
  { name: "matriculas", url: process.env.MCP_MATRICULAS_URL || "http://localhost:8002/mcp" },
  { name: "receitas", url: process.env.MCP_RECEITAS_URL || "http://localhost:8003/mcp" },
]);

// -----------------------------------------------------------------------
// Rotas
// -----------------------------------------------------------------------

app.get("/api/health", (c) => c.json({ status: "ok", service: "app", llmProvider: llm.providerName }));

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      })
    )
    .min(1),
});

app.post("/api/chat", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = chatRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Dados inválidos", details: parsed.error.issues }, 400);
  }

  try {
    const resultado = await sendChatMessage({ llm, tools: mcpTools }, parsed.data.messages);
    return c.json(resultado);
  } catch (err) {
    console.error("[app] Erro no /api/chat:", err);
    const mensagem = err instanceof Error ? err.message : "Erro desconhecido";
    return c.json({ error: "Erro ao processar a conversa", detalhe: mensagem }, 500);
  }
});

// -----------------------------------------------------------------------
// Em produção, serve o build estático do Vite (pasta dist/).
// Em desenvolvimento, o front roda separado (vite, porta 5173) com proxy
// de /api para este servidor — ver vite.config.ts e README.md.
// -----------------------------------------------------------------------

app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

const port = Number(process.env.PORT ?? 3000);
console.log(`[app] backend rodando na porta ${port} (LLM_PROVIDER=${llm.providerName})`);

export default {
  port,
  fetch: app.fetch,
};
