import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvalLog } from "./evalLog";

const original = process.env.EVAL_LOG_PATH;
const dirs: string[] = [];

afterEach(() => {
  if (original === undefined) delete process.env.EVAL_LOG_PATH;
  else process.env.EVAL_LOG_PATH = original;
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  dirs.length = 0;
});

describe("evalLog", () => {
  test("sem EVAL_LOG_PATH não lança", () => {
    delete process.env.EVAL_LOG_PATH;
    expect(() =>
      appendEvalLog({
        pergunta: "oi",
        resposta: "olá",
        evidencias: [],
        veredito: "aprovar",
        fonte: "llm",
      })
    ).not.toThrow();
  });

  test("grava JSONL e trunca resultado longo", () => {
    const dir = mkdtempSync(join(tmpdir(), "cookings-evallog-"));
    dirs.push(dir);
    const caminho = join(dir, "eval.jsonl");
    process.env.EVAL_LOG_PATH = caminho;

    appendEvalLog({
      pergunta: "quais cursos",
      resposta: "tem massas",
      evidencias: [
        {
          tool: "listar_cursos",
          argumentos: {},
          resultado: "x".repeat(800),
        },
      ],
      veredito: "aprovar",
      fonte: "cache",
    });

    const texto = readFileSync(caminho, "utf8");
    const linha = JSON.parse(texto.trim()) as {
      pergunta: string;
      fonte: string;
      evidencias: Array<{ resultado: string }>;
    };
    expect(linha.pergunta).toBe("quais cursos");
    expect(linha.fonte).toBe("cache");
    expect(linha.evidencias[0].resultado.length).toBe(500);
  });

  test("falha de disco não lança", () => {
    const dir = mkdtempSync(join(tmpdir(), "cookings-evallog-"));
    dirs.push(dir);
    process.env.EVAL_LOG_PATH = dir;
    expect(() =>
      appendEvalLog({
        pergunta: "x",
        resposta: "y",
        evidencias: [],
        veredito: "aprovar",
        fonte: "llm",
      })
    ).not.toThrow();
  });
});
