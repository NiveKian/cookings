import { afterEach, describe, expect, test } from "bun:test";
import { createJudgeAdapter } from "./judgeFactory";

const CHAVES = ["JUDGE_ENABLED", "JUDGE_PROVIDER", "JUDGE_MODEL", "OLLAMA_BASE_URL", "LLM_PROVIDER"] as const;
const originais: Record<(typeof CHAVES)[number], string | undefined> = {
  JUDGE_ENABLED: process.env.JUDGE_ENABLED,
  JUDGE_PROVIDER: process.env.JUDGE_PROVIDER,
  JUDGE_MODEL: process.env.JUDGE_MODEL,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  LLM_PROVIDER: process.env.LLM_PROVIDER,
};
const fetchOriginal = globalThis.fetch;

function restaurarEnv(): void {
  for (const chave of CHAVES) {
    const valor = originais[chave];
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
}

function urlDe(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const VEREDITO_JSON = JSON.stringify({
  veredito: "aprovar",
  notas: { fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 5, clareza: 5 },
  problemas: [],
});

describe("judgeFactory", () => {
  afterEach(() => {
    restaurarEnv();
    globalThis.fetch = fetchOriginal;
  });

  test("JUDGE_PROVIDER=ollama avalia com JSON do Ollama e não envia tools", async () => {
    process.env.JUDGE_ENABLED = "true";
    process.env.JUDGE_PROVIDER = "ollama";
    process.env.JUDGE_MODEL = "   ";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434/";
    process.env.LLM_PROVIDER = "mock";

    let url = "";
    let corpo: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      url = urlDe(input);
      corpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: VEREDITO_JSON } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const juiz = createJudgeAdapter();
    const resultado = await juiz.evaluate({
      pergunta: "Como faz bolo?",
      resposta: "Misture e asse.",
      evidencias: [],
    });

    expect(resultado.status).toBe("ok");
    expect(resultado.veredito).toBe("aprovar");
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(corpo).not.toBeNull();
    expect(corpo!.model).toBe("qwen2.5:1.5b");
    expect(corpo!.stream).toBe(false);
    expect(corpo).not.toHaveProperty("tools");
  });

  test("provider desconhecido não lança e o veredito fica indisponível", async () => {
    process.env.JUDGE_ENABLED = "true";
    process.env.JUDGE_PROVIDER = "desconhecido";
    delete process.env.JUDGE_MODEL;

    const juiz = createJudgeAdapter();
    const resultado = await juiz.evaluate({
      pergunta: "p",
      resposta: "r",
      evidencias: [],
    });

    expect(resultado.status).toBe("unavailable");
  });

  test("mock continua aprovando sem chamar a rede", async () => {
    process.env.JUDGE_ENABLED = "true";
    process.env.JUDGE_PROVIDER = "mock";
    globalThis.fetch = (async () => {
      throw new Error("mock não deve chamar fetch");
    }) as unknown as typeof fetch;

    const juiz = createJudgeAdapter();
    const resultado = await juiz.evaluate({
      pergunta: "p",
      resposta: "resposta clara",
      evidencias: [],
    });

    expect(resultado.status).toBe("ok");
    expect(resultado.veredito).toBe("aprovar");
  });
});
