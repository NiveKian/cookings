import { afterEach, describe, expect, test } from "bun:test";
import { createJudgeAdapter, readJudgeConfig } from "./judgeFactory";

const CHAVES = ["JUDGE_ENABLED", "JUDGE_PROVIDER", "JUDGE_MODEL", "JUDGE_MODE", "OLLAMA_BASE_URL", "LLM_PROVIDER"] as const;
const originais: Record<(typeof CHAVES)[number], string | undefined> = {
  JUDGE_ENABLED: process.env.JUDGE_ENABLED,
  JUDGE_PROVIDER: process.env.JUDGE_PROVIDER,
  JUDGE_MODEL: process.env.JUDGE_MODEL,
  JUDGE_MODE: process.env.JUDGE_MODE,
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

  test("JUDGE_PROVIDER=ollama com JUDGE_MODE=completo usa o schema do veredito e não envia tools", async () => {
    process.env.JUDGE_MODE = "completo";
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
    const format = corpo!.format as { properties: Record<string, unknown>; required: string[] };
    expect(format.properties.veredito).toEqual({ type: "string", enum: ["aprovar", "revisar", "reprovar"] });
    expect(format.required).toContain("notas");
    expect(corpo!.options).toEqual({ temperature: 0, num_ctx: 4096, num_predict: 400 });
  });

  test("JUDGE_TIMEOUT_MS 0 ou inválido cai no padrão de 60000", () => {
    const original = process.env.JUDGE_TIMEOUT_MS;
    try {
      process.env.JUDGE_TIMEOUT_MS = "0";
      expect(readJudgeConfig().timeoutMs).toBe(60000);
      process.env.JUDGE_TIMEOUT_MS = "abc";
      expect(readJudgeConfig().timeoutMs).toBe(60000);
      process.env.JUDGE_TIMEOUT_MS = "1500";
      expect(readJudgeConfig().timeoutMs).toBe(1500);
    } finally {
      if (original === undefined) delete process.env.JUDGE_TIMEOUT_MS;
      else process.env.JUDGE_TIMEOUT_MS = original;
    }
  });

  test("juiz ollama ignora JUDGE_TIMEOUT_MS e espera sem limite", async () => {
    const original = process.env.JUDGE_TIMEOUT_MS;
    process.env.JUDGE_ENABLED = "true";
    process.env.JUDGE_PROVIDER = "ollama";
    process.env.JUDGE_TIMEOUT_MS = "20";
    process.env.JUDGE_MODE = "completo";
    process.env.LLM_PROVIDER = "mock";
    globalThis.fetch = (async () => {
      await new Promise((r) => setTimeout(r, 60));
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: VEREDITO_JSON } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;
    try {
      const resultado = await createJudgeAdapter().evaluate({ pergunta: "p", resposta: "r", evidencias: [] });
      expect(resultado.status).toBe("ok");
    } finally {
      if (original === undefined) delete process.env.JUDGE_TIMEOUT_MS;
      else process.env.JUDGE_TIMEOUT_MS = original;
    }
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

  test("ollama usa o juiz de relevância por padrão; demais provedores usam o completo", () => {
    delete process.env.JUDGE_MODE;
    process.env.JUDGE_PROVIDER = "ollama";
    expect(readJudgeConfig().mode).toBe("relevancia");
    for (const provider of ["gemini", "claude", "gpt", "mock"]) {
      process.env.JUDGE_PROVIDER = provider;
      expect(readJudgeConfig().mode).toBe("completo");
    }
  });

  test("JUDGE_MODE sobrepõe o padrão; valor desconhecido cai no padrão", () => {
    process.env.JUDGE_PROVIDER = "ollama";
    process.env.JUDGE_MODE = "COMPLETO";
    expect(readJudgeConfig().mode).toBe("completo");
    process.env.JUDGE_PROVIDER = "claude";
    process.env.JUDGE_MODE = "relevancia";
    expect(readJudgeConfig().mode).toBe("relevancia");
    process.env.JUDGE_MODE = "xyz";
    expect(readJudgeConfig().mode).toBe("completo");
  });

  test("ollama em modo relevância envia o schema {motivo, atende} e mapeia o veredito", async () => {
    process.env.JUDGE_ENABLED = "true";
    process.env.JUDGE_PROVIDER = "ollama";
    process.env.LLM_PROVIDER = "mock";
    delete process.env.JUDGE_MODE;
    delete process.env.JUDGE_MODEL;

    let corpo: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      corpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          message: { role: "assistant", content: JSON.stringify({ motivo: "trata do pedido", atende: true }) },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const resultado = await createJudgeAdapter().evaluate({
      pergunta: "Como faz bolo?",
      resposta: "Misture e asse.",
      evidencias: [{ tool: "listar_receitas", argumentos: {}, resultado: [] }],
    });

    expect(resultado.status).toBe("ok");
    expect(resultado.modo).toBe("relevancia");
    expect(resultado.veredito).toBe("aprovar");
    expect(corpo!.format).toEqual({
      type: "object",
      properties: { motivo: { type: "string" }, atende: { type: "boolean" } },
      required: ["motivo", "atende"],
    });
    expect(JSON.stringify(corpo!.messages)).not.toContain("listar_receitas");
  });
});
