import type { ChatMessage } from "../../domain/entities";
import type { LLMPort } from "../../domain/ports/LLMPort";
import type { ToolsPort } from "../../domain/ports/ToolsPort";
import type { Evidencia, JudgePort, JudgeVerdict } from "../../domain/ports/JudgePort";
import { vereditoIndisponivel } from "../../domain/ports/JudgePort";
import { sendChatMessage, type SendChatMessageResult } from "./sendChatMessage";

export const AVISO_RESPOSTA_NAO_VERIFICADA = "Aviso: esta resposta não foi totalmente verificada.";

export interface AnswerQuestionDeps {
  llm: LLMPort;
  tools: ToolsPort;
  judge?: JudgePort | null;
  judgeEnabled?: boolean;
  maxRevisions?: number;
}

export interface CacheMeta {
  usado: false;
  motivo: "sem-cache" | "juiz-indisponivel";
}

export interface AnswerQuestionResult {
  reply: string;
  toolCallsExecuted: string[];
  evidencias: Evidencia[];
  judge: JudgeVerdict;
  cache: CacheMeta;
}

/**
 * Orquestra o chat com o juiz. sendChatMessage permanece o loop de tools;
 * daqui saem revisão, aviso de recusa e o placeholder de cache (Fase 4).
 */
export async function answerQuestion(
  deps: AnswerQuestionDeps,
  history: ChatMessage[]
): Promise<AnswerQuestionResult> {
  const enabled = deps.judgeEnabled === true && !!deps.judge;
  const maxRevisions = deps.maxRevisions ?? 1;

  if (!enabled) {
    const gerado = await sendChatMessage({ llm: deps.llm, tools: deps.tools }, history);
    return {
      ...gerado,
      judge: vereditoIndisponivel(),
      cache: { usado: false, motivo: "juiz-indisponivel" },
    };
  }

  const pergunta =
    [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  const judge = deps.judge as JudgePort;
  let historico = history;
  let ultimo: SendChatMessageResult | null = null;
  let ultimoJudge: JudgeVerdict = vereditoIndisponivel();

  for (let revisao = 0; revisao <= maxRevisions; revisao++) {
    ultimo = await sendChatMessage({ llm: deps.llm, tools: deps.tools }, historico);
    const aindaHaRevisao = revisao < maxRevisions;

    let bruto: JudgeVerdict;
    try {
      bruto = await judge.evaluate({
        pergunta,
        resposta: ultimo.reply,
        evidencias: ultimo.evidencias,
      });
    } catch (err) {
      console.warn("[judge] evaluate lançou; fail-open na entrega:", err);
      bruto = vereditoIndisponivel();
    }

    if (bruto.status === "unavailable") {
      return {
        ...ultimo,
        judge: vereditoIndisponivel(),
        cache: { usado: false, motivo: "juiz-indisponivel" },
      };
    }

    const ajustado = aplicarRegraAprovar(bruto, aindaHaRevisao);
    ultimoJudge = ajustado;

    if (ajustado.veredito === "aprovar") {
      return {
        ...ultimo,
        judge: ajustado,
        cache: { usado: false, motivo: "sem-cache" },
      };
    }

    if (ajustado.veredito === "revisar" && aindaHaRevisao) {
      const feedback =
        ajustado.feedbackParaRegeneracao?.trim() ||
        "Revise a resposta anterior corrigindo os problemas apontados.";
      historico = [
        ...historico,
        { role: "assistant", content: ultimo.reply },
        { role: "user", content: feedback },
      ];
      continue;
    }

    break;
  }

  const gerado = ultimo as SendChatMessageResult;
  return {
    ...gerado,
    reply: anexarAviso(gerado.reply),
    judge: { ...ultimoJudge, veredito: "reprovar" },
    cache: { usado: false, motivo: "sem-cache" },
  };
}

function notasPassam(v: JudgeVerdict): boolean {
  const n = v.notas;
  return [n.fidelidade, n.coerencia, n.seguranca, n.relevancia, n.clareza].every((nota) => nota >= 4);
}

function aplicarRegraAprovar(v: JudgeVerdict, aindaHaRevisao: boolean): JudgeVerdict {
  const aprovavel = notasPassam(v) && !v.problemas.some((p) => p.bloqueante);

  if (v.veredito === "aprovar") {
    if (aprovavel) return v;
    if (aindaHaRevisao) {
      return {
        ...v,
        veredito: "revisar",
        feedbackParaRegeneracao:
          v.feedbackParaRegeneracao?.trim() ||
          "Corrija os problemas apontados e reescreva a resposta.",
      };
    }
    return { ...v, veredito: "reprovar" };
  }

  if (v.veredito === "revisar" && !aindaHaRevisao) {
    return { ...v, veredito: "reprovar" };
  }

  return v;
}

function anexarAviso(reply: string): string {
  if (reply.endsWith(AVISO_RESPOSTA_NAO_VERIFICADA)) return reply;
  return reply.length > 0 ? `${reply}\n${AVISO_RESPOSTA_NAO_VERIFICADA}` : AVISO_RESPOSTA_NAO_VERIFICADA;
}
