import type { ChatMessage } from "../../domain/entities";
import type { Evidencia, JudgeVerdict } from "../../domain/ports/JudgePort";
import { semAcento } from "../../domain/texto";
import { isMutableTool, toolDomain } from "../../domain/toolPolicy";

const MARCADORES_NOVIDADE = ["invent", "outra", "diferente", "surpreend"] as const;

/** Sem acento, minúsculo, espaços colapsados. Entrada do embed/cache. */
export function normalizarPergunta(texto: string): string {
  return semAcento(texto).replace(/\s+/g, " ").trim();
}

/** Exatamente 1 mensagem role user no histórico (follow-up não é cacheável). */
export function isStandalone(history: ChatMessage[]): boolean {
  return history.filter((m) => m.role === "user").length === 1;
}

/**
 * Pedido de novidade: a pergunta (sem acento, minúscula) contém invent,
 * outra, diferente ou surpreend. Ex.: "inventar", "outra receita",
 * "diferente", "surpreenda".
 */
export function isPedidoDeNovidade(pergunta: string): boolean {
  const t = semAcento(pergunta);
  return MARCADORES_NOVIDADE.some((m) => t.includes(m));
}

export function temToolMutavel(evidencias: Evidencia[]): boolean {
  return evidencias.some((e) => isMutableTool(e.tool));
}

/** Domínios das tools usadas, sem null, únicos. */
export function dominiosDasEvidencias(evidencias: Evidencia[]): string[] {
  const vistos = new Set<string>();
  for (const e of evidencias) {
    const d = toolDomain(e.tool);
    if (d) vistos.add(d);
  }
  return Array.from(vistos);
}

/** Domínios só das tools mutáveis (para invalidar o cache). */
export function dominiosMutaveis(evidencias: Evidencia[]): string[] {
  const vistos = new Set<string>();
  for (const e of evidencias) {
    if (!isMutableTool(e.tool)) continue;
    const d = toolDomain(e.tool);
    if (d) vistos.add(d);
  }
  return Array.from(vistos);
}

export function podeConsultarCache(opts: {
  cacheEnabled: boolean;
  history: ChatMessage[];
  pergunta: string;
}): boolean {
  return opts.cacheEnabled && isStandalone(opts.history) && !isPedidoDeNovidade(opts.pergunta);
}

export function podeGravarCache(opts: {
  cacheEnabled: boolean;
  history: ChatMessage[];
  pergunta: string;
  judge: JudgeVerdict;
  evidencias: Evidencia[];
  embeddingOk: boolean;
}): boolean {
  return (
    opts.cacheEnabled &&
    isStandalone(opts.history) &&
    !isPedidoDeNovidade(opts.pergunta) &&
    opts.judge.status === "ok" &&
    opts.judge.veredito === "aprovar" &&
    !temToolMutavel(opts.evidencias) &&
    opts.embeddingOk
  );
}
