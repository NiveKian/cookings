import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { z } from "zod";
import { answerQuestion } from "./src/application/chat/answerQuestion";
import { createLLMAdapter } from "./src/infrastructure/llm/llmFactory";
import { createJudgeAdapter, readJudgeConfig } from "./src/infrastructure/judge/judgeFactory";
import { createEmbeddingAdapter } from "./src/infrastructure/embeddings/embeddingFactory";
import { SqliteSemanticCache } from "./src/infrastructure/cache/SqliteSemanticCache";
import { McpToolsAdapter } from "./src/infrastructure/mcp/McpToolsAdapter";
import { recordChatAnswer, snapshotChatMetrics } from "./src/infrastructure/metrics/chatMetrics";
import { appendEvalLog } from "./src/infrastructure/metrics/evalLog";

const app = new Hono();

app.use("*", cors());

// -----------------------------------------------------------------------
// Dependências (hexagonal: trocar de provedor de IA = trocar só aqui)
// -----------------------------------------------------------------------

const llm = createLLMAdapter();
const judgeConfig = readJudgeConfig();
const judge = createJudgeAdapter(judgeConfig);
const embedding = createEmbeddingAdapter();
const cacheConfig = readCacheConfig();
const cache = new SqliteSemanticCache(cacheConfig.dbPath);

function mcpUrl(base: string, fallback: string): string {
  const isLocal = process.env.APP_ENV === "local";
  const key = isLocal ? `${base}_DEV` : base;
  return process.env[key] || fallback;
}

const mcpTools = new McpToolsAdapter([
  { name: "cursos", url: mcpUrl("MCP_CURSOS_URL", "http://localhost:8001/mcp") },
  { name: "matriculas", url: mcpUrl("MCP_MATRICULAS_URL", "http://localhost:8002/mcp") },
  { name: "receitas", url: mcpUrl("MCP_RECEITAS_URL", "http://localhost:8003/mcp") },
]);

// -----------------------------------------------------------------------
// Rotas
// -----------------------------------------------------------------------

app.get("/api/health", (c) => c.json({ status: "ok", service: "app", llmProvider: llm.providerName }));

app.get("/api/metrics", (c) => c.json(snapshotChatMetrics()));

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
    const pergunta =
      [...parsed.data.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const t0 = Date.now();
    const resultado = await answerQuestion(
      {
        llm,
        tools: mcpTools,
        judge,
        judgeEnabled: judgeConfig.enabled,
        maxRevisions: judgeConfig.maxRevisions,
        cache,
        embedding,
        cacheEnabled: cacheConfig.enabled,
        cacheSimilarityThreshold: cacheConfig.similarityThreshold,
        cacheTtlMinutes: cacheConfig.ttlMinutes,
      },
      parsed.data.messages
    );
    const latenciaMs = Date.now() - t0;
    recordChatAnswer({
      hit: resultado.cache.usado,
      veredito: resultado.judge.veredito,
      status: resultado.judge.status,
      notas: resultado.judge.notas,
      latenciaMs,
    });
    appendEvalLog({
      pergunta,
      resposta: resultado.reply,
      evidencias: resultado.evidencias,
      veredito: resultado.judge.veredito,
      fonte: resultado.cache.usado ? "cache" : "llm",
    });
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
console.log(
  `[app] backend rodando na porta ${port} (LLM_PROVIDER=${llm.providerName}, JUDGE_ENABLED=${judgeConfig.enabled}, CACHE_ENABLED=${cacheConfig.enabled}, EMBEDDING=${embedding.modelo})`
);

export default {
  port,
  fetch: app.fetch,
  // Bun.serve fecha conexões ociosas após 10 s por padrão; 0 desliga.
  // O juiz Ollama pode demorar minutos e /api/chat espera o veredito.
  idleTimeout: 0,
};

/** Só a string "true" liga o cache. Limiar padrão 0.9; TTL padrão 60 min. */
function readCacheConfig(): {
  enabled: boolean;
  similarityThreshold: number;
  ttlMinutes: number;
  dbPath: string;
} {
  return {
    enabled: process.env.CACHE_ENABLED === "true",
    similarityThreshold: parseEnvFloat(process.env.CACHE_SIMILARITY_THRESHOLD, 0.9),
    ttlMinutes: parseEnvInt(process.env.CACHE_TTL_MINUTES, 60),
    dbPath: process.env.CACHE_DB_PATH?.trim() || "./data/cache.sqlite",
  };
}

function parseEnvFloat(raw: string | undefined, padrao: number): number {
  if (raw === undefined || raw.trim() === "") return padrao;
  const n = Number(raw);
  return Number.isFinite(n) ? n : padrao;
}

function parseEnvInt(raw: string | undefined, padrao: number): number {
  if (raw === undefined || raw.trim() === "") return padrao;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return padrao;
  return Math.floor(n);
}
