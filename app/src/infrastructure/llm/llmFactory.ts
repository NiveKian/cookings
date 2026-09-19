import type { LLMPort } from "../../domain/ports/LLMPort";
import { GeminiAdapter } from "./GeminiAdapter";
import { ClaudeAdapter } from "./ClaudeAdapter";
import { GptAdapter } from "./GptAdapter";
import { MockAdapter } from "./MockAdapter";

// Ponto único de troca de provedor de IA. Definido por LLM_PROVIDER no
// .env: "gemini" (padrão), "claude", "gpt", ou "mock" (testes offline).
export function createLLMAdapter(): LLMPort {
  const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();

  switch (provider) {
    case "claude": {
      const apiKey = requireEnv("ANTHROPIC_API_KEY");
      return new ClaudeAdapter(apiKey, process.env.CLAUDE_MODEL);
    }
    case "gpt": {
      const apiKey = requireEnv("OPENAI_API_KEY");
      return new GptAdapter(apiKey, process.env.OPENAI_MODEL);
    }
    case "mock":
      return new MockAdapter();
    case "gemini":
    default: {
      const apiKey = requireEnv("GEMINI_API_KEY");
      return new GeminiAdapter(apiKey, process.env.GEMINI_MODEL);
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} não definida. Configure-a no .env (ver .env.example) para usar este provedor de LLM.`
    );
  }
  return value;
}
