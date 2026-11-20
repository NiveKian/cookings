import type { JudgePort } from "../../domain/ports/JudgePort";
import { vereditoIndisponivel } from "../../domain/ports/JudgePort";
import type { LLMPort } from "../../domain/ports/LLMPort";
import { GeminiAdapter } from "../llm/GeminiAdapter";
import { ClaudeAdapter } from "../llm/ClaudeAdapter";
import { GptAdapter } from "../llm/GptAdapter";
import { OllamaAdapter, urlSemBarraFinal } from "../llm/OllamaAdapter";
import { LLMJudgeAdapter, TIMEOUT_JUIZ_PADRAO_MS, VEREDITO_JSON_SCHEMA } from "./LLMJudgeAdapter";
import { MockJudgeAdapter } from "./MockJudgeAdapter";

export interface JudgeConfig {
  enabled: boolean;
  provider: string;
  maxRevisions: number;
  evidenceMaxChars: number;
  /** Teto da avaliação em ms (JUDGE_TIMEOUT_MS). Estourou = unavailable. */
  timeoutMs: number;
}

/**
 * Só a string "true" liga o juiz. Ausente ou qualquer outro valor = desligado,
 * para .env antigo não quebrar o chat.
 */
export function readJudgeConfig(): JudgeConfig {
  const provider = (process.env.JUDGE_PROVIDER || "mock").toLowerCase();
  return {
    enabled: process.env.JUDGE_ENABLED === "true",
    provider,
    maxRevisions: parseEnvNumber(process.env.JUDGE_MAX_REVISIONS, 1),
    evidenceMaxChars: parseEnvNumber(process.env.JUDGE_EVIDENCE_MAX_CHARS, 6000),
    timeoutMs: parseTimeoutMs(process.env.JUDGE_TIMEOUT_MS),
  };
}

/** 0, negativo, vazio ou inválido = padrão (60000 ms). */
function parseTimeoutMs(raw: string | undefined): number {
  const n = parseEnvNumber(raw, TIMEOUT_JUIZ_PADRAO_MS);
  return n > 0 ? n : TIMEOUT_JUIZ_PADRAO_MS;
}

export function createJudgeAdapter(config: JudgeConfig = readJudgeConfig()): JudgePort {
  avisarSeMesmoProvedor(config);

  if (!config.enabled || config.provider === "mock") {
    return new MockJudgeAdapter();
  }

  const llm = tentarCriarLlmDoJuiz(config.provider, process.env.JUDGE_MODEL);
  if (!llm) {
    return new UnavailableJudgeAdapter();
  }

  return new LLMJudgeAdapter(llm, config.evidenceMaxChars, config.timeoutMs);
}

function avisarSeMesmoProvedor(config: JudgeConfig): void {
  if (!config.enabled) return;
  const llmProvider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  if (config.provider !== "mock" && config.provider === llmProvider) {
    console.warn(
      `[judge] JUDGE_PROVIDER (${config.provider}) é igual a LLM_PROVIDER; use outro provedor/modelo para o juiz.`
    );
  }
}

function tentarCriarLlmDoJuiz(provider: string, modelRaw: string | undefined): LLMPort | null {
  const model = modelRaw?.trim() || undefined;

  switch (provider) {
    case "claude": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.warn("[judge] ANTHROPIC_API_KEY ausente; juiz indisponível.");
        return null;
      }
      return new ClaudeAdapter(apiKey, model);
    }
    case "gpt": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.warn("[judge] OPENAI_API_KEY ausente; juiz indisponível.");
        return null;
      }
      return new GptAdapter(apiKey, model);
    }
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn("[judge] GEMINI_API_KEY ausente; juiz indisponível.");
        return null;
      }
      return new GeminiAdapter(apiKey, model ?? "gemini-flash-latest");
    }
    case "ollama": {
      // Sem chave. URL e modelo vazios caem no padrão local.
      // format = JSON schema do veredito: o modelo pequeno não foge do contrato.
      const baseUrl = urlSemBarraFinal(process.env.OLLAMA_BASE_URL, "http://127.0.0.1:11434");
      return new OllamaAdapter(baseUrl, model ?? "qwen2.5:1.5b", { format: VEREDITO_JSON_SCHEMA });
    }
    default:
      console.warn(`[judge] JUDGE_PROVIDER desconhecido (${provider}); juiz indisponível.`);
      return null;
  }
}

function parseEnvNumber(raw: string | undefined, padrao: number): number {
  if (raw === undefined || raw.trim() === "") return padrao;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return padrao;
  return Math.floor(n);
}

/** Fail-open: nunca lança; o orquestrador entrega a resposta mesmo assim. */
class UnavailableJudgeAdapter implements JudgePort {
  async evaluate(): Promise<ReturnType<typeof vereditoIndisponivel>> {
    return vereditoIndisponivel();
  }
}
