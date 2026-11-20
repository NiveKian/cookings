import type { JudgePort } from "../../domain/ports/JudgePort";
import { vereditoIndisponivel } from "../../domain/ports/JudgePort";
import type { LLMPort } from "../../domain/ports/LLMPort";
import { GeminiAdapter } from "../llm/GeminiAdapter";
import { ClaudeAdapter } from "../llm/ClaudeAdapter";
import { GptAdapter } from "../llm/GptAdapter";
import { OllamaAdapter, urlSemBarraFinal } from "../llm/OllamaAdapter";
import { LLMJudgeAdapter, TIMEOUT_JUIZ_PADRAO_MS, VEREDITO_JSON_SCHEMA } from "./LLMJudgeAdapter";
import { MockJudgeAdapter } from "./MockJudgeAdapter";
import { RELEVANCIA_JSON_SCHEMA, RelevanceJudgeAdapter } from "./RelevanceJudgeAdapter";

/** "completo": rubrica de cinco critérios. "relevancia": juiz leve, só confere se atende ao pedido. */
export type JudgeMode = "completo" | "relevancia";

export interface JudgeConfig {
  enabled: boolean;
  provider: string;
  maxRevisions: number;
  evidenceMaxChars: number;
  /** Teto da avaliação em ms (JUDGE_TIMEOUT_MS). Estourou = unavailable. Ignorado no ollama. */
  timeoutMs: number;
  /** JUDGE_MODE. Padrão: "relevancia" no ollama, "completo" nos demais. */
  mode: JudgeMode;
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
    mode: parseJudgeMode(process.env.JUDGE_MODE, provider),
  };
}

/**
 * Modelo local pequeno (ollama) não segura a rubrica de cinco critérios:
 * por padrão usa o juiz leve. Valor vazio ou desconhecido = padrão.
 */
function parseJudgeMode(raw: string | undefined, provider: string): JudgeMode {
  const valor = raw?.trim().toLowerCase();
  if (valor === "completo" || valor === "relevancia") return valor;
  return provider === "ollama" ? "relevancia" : "completo";
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

  const llm = tentarCriarLlmDoJuiz(config.provider, process.env.JUDGE_MODEL, config.mode);
  if (!llm) {
    return new UnavailableJudgeAdapter();
  }

  // Ollama roda em CPU local e é lento; o usuário prefere esperar o veredito.
  // Sem limite: JUDGE_TIMEOUT_MS só vale para os juízes em nuvem.
  const timeoutMs = config.provider === "ollama" ? Infinity : config.timeoutMs;
  if (config.mode === "relevancia") {
    return new RelevanceJudgeAdapter(llm, timeoutMs);
  }
  return new LLMJudgeAdapter(llm, config.evidenceMaxChars, timeoutMs);
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

function tentarCriarLlmDoJuiz(
  provider: string,
  modelRaw: string | undefined,
  mode: JudgeMode
): LLMPort | null {
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
      // format = JSON schema do modo escolhido: o modelo pequeno não foge do contrato.
      const baseUrl = urlSemBarraFinal(process.env.OLLAMA_BASE_URL, "http://127.0.0.1:11434");
      const format = mode === "relevancia" ? RELEVANCIA_JSON_SCHEMA : VEREDITO_JSON_SCHEMA;
      return new OllamaAdapter(baseUrl, model ?? "qwen2.5:1.5b", { format });
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
