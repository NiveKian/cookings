import { afterEach, describe, expect, test } from "bun:test";
import { OllamaAdapter } from "./OllamaAdapter";

const fetchOriginal = globalThis.fetch;

function urlDe(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("OllamaAdapter", () => {
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  test("POST /api/chat com model, stream false, system+user e sem tools", async () => {
    let url = "";
    let initCapturado: RequestInit | undefined;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      url = urlDe(input);
      initCapturado = init;
      return new Response(JSON.stringify({ message: { role: "assistant", content: "veredito" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter();
    const resultado = await adapter.converse({
      systemPrompt: "Você é o juiz.",
      turns: [
        { role: "user", content: "pergunta" },
        { role: "assistant", content: "rascunho" },
      ],
      tools: [],
    });

    expect(adapter.providerName).toBe("ollama");
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(initCapturado?.method).toBe("POST");

    const body = JSON.parse(String(initCapturado?.body)) as Record<string, unknown>;
    expect(body.model).toBe("qwen2.5:1.5b");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "Você é o juiz." },
      { role: "user", content: "pergunta" },
      { role: "assistant", content: "rascunho" },
    ]);
    expect(body).not.toHaveProperty("tools");
    expect(resultado).toEqual({ type: "text", text: "veredito" });
  });

  test("HTTP 500 lança", async () => {
    globalThis.fetch = (async () => new Response("falhou", { status: 500 })) as unknown as typeof fetch;
    const adapter = new OllamaAdapter("http://127.0.0.1:11434", "qwen2.5:1.5b");
    await expect(
      adapter.converse({
        systemPrompt: "s",
        turns: [{ role: "user", content: "u" }],
        tools: [],
      })
    ).rejects.toThrow(/500/);
  });

  test("falha de rede lança", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const adapter = new OllamaAdapter();
    await expect(
      adapter.converse({
        systemPrompt: "s",
        turns: [{ role: "user", content: "u" }],
        tools: [],
      })
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  test("base URL com barra final não duplica barra", async () => {
    let url = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      url = urlDe(input);
      return new Response(JSON.stringify({ message: { role: "assistant", content: "ok" } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter("http://ollama:11434/", "qwen2.5:1.5b");
    await adapter.converse({
      systemPrompt: "s",
      turns: [{ role: "user", content: "u" }],
      tools: [],
    });

    expect(url).toBe("http://ollama:11434/api/chat");
  });

  test("tools não vazias não entram no JSON", async () => {
    let bodyBruto = "";
    const avisos: unknown[][] = [];
    const warnOriginal = console.warn;
    console.warn = (...args: unknown[]) => {
      avisos.push(args);
    };

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodyBruto = String(init?.body);
      return new Response(JSON.stringify({ message: { role: "assistant", content: "só texto" } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      const adapter = new OllamaAdapter("http://127.0.0.1:11434", "qwen2.5:1.5b");
      const resultado = await adapter.converse({
        systemPrompt: "s",
        turns: [{ role: "user", content: "u" }],
        tools: [{ name: "listar_receitas", description: "lista", inputSchema: { type: "object" } }],
      });

      const body = JSON.parse(bodyBruto) as Record<string, unknown>;
      expect(body).not.toHaveProperty("tools");
      expect(resultado).toEqual({ type: "text", text: "só texto" });
      expect(avisos.some((a) => String(a[0]).includes("tools"))).toBe(true);
    } finally {
      console.warn = warnOriginal;
    }
  });
});
