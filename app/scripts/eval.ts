/**
 * Avaliação offline do orquestrador (Fase 5).
 * MockAdapter + MockJudgeAdapter + MockEmbeddingAdapter + sqlite temporário.
 * ToolsPort vazio (eco). Juiz ligado. Números só saem desta execução.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerQuestion } from "../src/application/chat/answerQuestion";
import type { ChatMessage } from "../src/domain/entities";
import type { LLMPort } from "../src/domain/ports/LLMPort";
import type { ToolsPort } from "../src/domain/ports/ToolsPort";
import { SqliteSemanticCache } from "../src/infrastructure/cache/SqliteSemanticCache";
import { MockEmbeddingAdapter } from "../src/infrastructure/embeddings/MockEmbeddingAdapter";
import { MockJudgeAdapter } from "../src/infrastructure/judge/MockJudgeAdapter";
import { MockAdapter } from "../src/infrastructure/llm/MockAdapter";
import perguntasJson from "./eval-questions.json";

const LIMIAR = 0.9;

interface EvalQuestion {
  id: number;
  pergunta: string;
  followUp?: boolean;
}

const perguntas = perguntasJson as EvalQuestion[];

function toolsVazias(): ToolsPort {
  return {
    listTools: async () => [],
    callTool: async () => ({}),
  };
}

function countingLlm(): LLMPort & { converseCalls: number } {
  const inner = new MockAdapter();
  const wrapped = {
    providerName: inner.providerName,
    converseCalls: 0,
    converse: async (params: Parameters<LLMPort["converse"]>[0]) => {
      wrapped.converseCalls += 1;
      return inner.converse(params);
    },
  };
  return wrapped;
}

function mediaNotas(notas: {
  fidelidade: number;
  coerencia: number;
  seguranca: number;
  relevancia: number;
  clareza: number;
}): number {
  return (notas.fidelidade + notas.coerencia + notas.seguranca + notas.relevancia + notas.clareza) / 5;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s.padEnd(n, " ");
}

function fmt(n: number, casas: number): string {
  return n.toFixed(casas);
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "cookings-eval-"));
  const cache = new SqliteSemanticCache(join(dir, "cache.sqlite"));
  const llm = countingLlm();

  const deps = {
    llm,
    tools: toolsVazias(),
    judge: new MockJudgeAdapter(),
    judgeEnabled: true,
    maxRevisions: 1,
    cache,
    embedding: new MockEmbeddingAdapter(),
    cacheEnabled: true,
    cacheSimilarityThreshold: LIMIAR,
    cacheTtlMinutes: 60,
  };

  let historicoAnterior: ChatMessage[] = [];
  let hits = 0;
  let somaMedias = 0;
  let notasOk = 0;

  const linhas: Array<{
    id: number;
    pergunta: string;
    fonte: string;
    hit: string;
    veredito: string;
    notas: string;
  }> = [];

  try {
    for (const q of perguntas) {
      const history: ChatMessage[] = q.followUp
        ? [...historicoAnterior, { role: "user", content: q.pergunta }]
        : [{ role: "user", content: q.pergunta }];

      const resultado = await answerQuestion(deps, history);
      historicoAnterior = [...history, { role: "assistant", content: resultado.reply }];

      const hit = resultado.cache.usado;
      if (hit) hits += 1;
      if (resultado.judge.status === "ok") {
        somaMedias += mediaNotas(resultado.judge.notas);
        notasOk += 1;
      }

      linhas.push({
        id: q.id,
        pergunta: q.pergunta,
        fonte: hit ? "cache" : "llm",
        hit: hit ? "sim" : "nao",
        veredito: resultado.judge.veredito,
        notas: resultado.judge.status === "ok" ? fmt(mediaNotas(resultado.judge.notas), 2) : "-",
      });
    }
  } finally {
    cache.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows às vezes segura o sqlite; a pasta temp some sozinha.
    }
  }

  const total = perguntas.length;
  const misses = total - hits;
  const taxaHit = total === 0 ? 0 : (hits / total) * 100;
  const media = notasOk === 0 ? 0 : somaMedias / notasOk;
  const chamadasLlm = llm.converseCalls;

  console.log("============================================================");
  console.log("Avaliação Cookings (mocks + sqlite temporário, juiz ligado)");
  console.log(`limiar de similaridade: ${fmt(LIMIAR, 2)}`);
  console.log("============================================================");
  console.log(
    `${pad("id", 4)} ${pad("pergunta", 42)} ${pad("fonte", 6)} ${pad("hit", 4)} ${pad("veredito", 10)} ${pad("notas", 6)}`
  );
  console.log("-".repeat(78));
  for (const l of linhas) {
    console.log(
      `${pad(String(l.id), 4)} ${pad(l.pergunta, 42)} ${pad(l.fonte, 6)} ${pad(l.hit, 4)} ${pad(l.veredito, 10)} ${pad(l.notas, 6)}`
    );
  }
  console.log("-".repeat(78));
  console.log("RESUMO");
  console.log(`perguntas           ${total}`);
  console.log(`hits                ${hits}`);
  console.log(`misses              ${misses}`);
  console.log(`taxa HIT            ${fmt(taxaHit, 2)}%`);
  console.log(`media notas         ${fmt(media, 2)}`);
  console.log(`chamadas LLM        ${chamadasLlm}`);
  console.log("============================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
