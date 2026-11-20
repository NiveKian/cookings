import type { ChatMessage } from "../../domain/entities";
import type { LLMPort } from "../../domain/ports/LLMPort";
import type { ToolsPort } from "../../domain/ports/ToolsPort";
import type { Evidencia, JudgePort, JudgeVerdict } from "../../domain/ports/JudgePort";
import { vereditoIndisponivel } from "../../domain/ports/JudgePort";
import type { EmbeddingPort } from "../../domain/ports/EmbeddingPort";
import type { SemanticCachePort } from "../../domain/ports/SemanticCachePort";
import { sendChatMessage, type SendChatMessageResult } from "./sendChatMessage";
import {
  dominiosDasEvidencias,
  dominiosMutaveis,
  isPedidoDeNovidade,
  isStandalone,
  podeConsultarCache,
  podeGravarCache,
  temToolMutavel,
  normalizarPergunta,
} from "./cacheRules";

export const AVISO_RESPOSTA_NAO_VERIFICADA = "Aviso: o juiz não aprovou esta resposta.";

export interface AnswerQuestionDeps {
  llm: LLMPort;
  tools: ToolsPort;
  judge?: JudgePort | null;
  judgeEnabled?: boolean;
  maxRevisions?: number;
  cache?: SemanticCachePort | null;
  embedding?: EmbeddingPort | null;
  cacheEnabled?: boolean;
  cacheSimilarityThreshold?: number;
  cacheTtlMinutes?: number;
}

export interface CacheMeta {
  usado: boolean;
  motivo: string;
  similaridade?: number;
}

export interface AnswerQuestionResult {
  reply: string;
  toolCallsExecuted: string[];
  evidencias: Evidencia[];
  judge: JudgeVerdict;
  cache: CacheMeta;
}

/**
 * Orquestra o chat: cache semântico → LLM + tools → juiz → grava/invalida.
 * Falha de embed/sqlite nunca derruba o chat (log e segue como MISS).
 */
export async function answerQuestion(
  deps: AnswerQuestionDeps,
  history: ChatMessage[]
): Promise<AnswerQuestionResult> {
  const cacheEnabled = deps.cacheEnabled === true;
  const cache = deps.cache ?? null;
  const embeddingPort = deps.embedding ?? null;
  const limiar = deps.cacheSimilarityThreshold ?? 0.9;
  const ttlMinutes = deps.cacheTtlMinutes ?? 60;

  const pergunta =
    [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const perguntaNorm = normalizarPergunta(pergunta);

  let vetor: number[] | null = null;

  if (podeConsultarCache({ cacheEnabled, history, pergunta }) && cache && embeddingPort) {
    try {
      vetor = await embeddingPort.embed(perguntaNorm);
      const hit = await cache.lookup(perguntaNorm, vetor, embeddingPort.modelo, limiar);
      if (hit) {
        return {
          reply: hit.resposta,
          toolCallsExecuted: [],
          evidencias: [],
          judge: vereditoDoCache(),
          cache: { usado: true, motivo: "hit", similaridade: hit.similaridade },
        };
      }
    } catch (err) {
      console.warn("[cache] lookup/embed falhou; segue como MISS:", err);
      vetor = null;
    }
  }

  const gerado = await gerarComJuiz(deps, history, pergunta);

  await tentarInvalidar(cache, gerado.evidencias);

  if (
    podeGravarCache({
      cacheEnabled,
      history,
      pergunta,
      judge: gerado.judge,
      evidencias: gerado.evidencias,
      embeddingOk: true,
    }) &&
    cache &&
    embeddingPort
  ) {
    try {
      if (!vetor) vetor = await embeddingPort.embed(perguntaNorm);
      await cache.store({
        pergunta: perguntaNorm,
        embedding: vetor,
        resposta: gerado.reply,
        dominios: dominiosDasEvidencias(gerado.evidencias),
        modeloEmbedding: embeddingPort.modelo,
        ttlMinutes,
      });
    } catch (err) {
      console.warn("[cache] store/embed falhou; resposta segue sem gravar:", err);
      vetor = null;
    }
  }

  return {
    ...gerado,
    cache: {
      usado: false,
      motivo: motivoSemHit({
        cacheEnabled,
        history,
        pergunta,
        judge: gerado.judge,
        evidencias: gerado.evidencias,
      }),
    },
  };
}

async function gerarComJuiz(
  deps: AnswerQuestionDeps,
  history: ChatMessage[],
  pergunta: string
): Promise<Omit<AnswerQuestionResult, "cache">> {
  const enabled = deps.judgeEnabled === true && !!deps.judge;
  const maxRevisions = deps.maxRevisions ?? 1;

  if (!enabled) {
    const gerado = await sendChatMessage({ llm: deps.llm, tools: deps.tools }, history);
    return {
      ...gerado,
      judge: vereditoIndisponivel(),
    };
  }

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
      };
    }

    const ajustado = aplicarRegraAprovar(bruto, aindaHaRevisao);
    ultimoJudge = ajustado;

    if (ajustado.veredito === "aprovar") {
      return {
        ...ultimo,
        judge: ajustado,
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
  };
}

async function tentarInvalidar(cache: SemanticCachePort | null, evidencias: Evidencia[]): Promise<void> {
  if (!cache) return;
  const dominios = dominiosMutaveis(evidencias);
  if (dominios.length === 0) return;
  try {
    await cache.invalidateByDomains(dominios);
  } catch (err) {
    console.warn("[cache] invalidateByDomains falhou:", err);
  }
}

function motivoSemHit(opts: {
  cacheEnabled: boolean;
  history: ChatMessage[];
  pergunta: string;
  judge: JudgeVerdict;
  evidencias: Evidencia[];
}): string {
  if (!opts.cacheEnabled) {
    return opts.judge.status === "unavailable" ? "juiz-indisponivel" : "sem-cache";
  }
  if (!isStandalone(opts.history)) return "nao-standalone";
  if (isPedidoDeNovidade(opts.pergunta)) return "novidade";
  if (temToolMutavel(opts.evidencias)) return "mutavel";
  if (opts.judge.status === "unavailable") return "juiz-indisponivel";
  if (opts.judge.veredito !== "aprovar") return "reprovado";
  return "miss";
}

function vereditoDoCache(): JudgeVerdict {
  return {
    status: "ok",
    veredito: "aprovar",
    notas: { fidelidade: 5, coerencia: 5, seguranca: 5, relevancia: 5, clareza: 5 },
    problemas: [],
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
