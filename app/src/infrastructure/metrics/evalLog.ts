import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Evidencia } from "../../domain/ports/JudgePort";

const LIMITE_RESULTADO = 500;

export interface EvalLogEntrada {
  pergunta: string;
  resposta: string;
  evidencias: Evidencia[];
  veredito: string;
  fonte: "cache" | "llm";
}

/**
 * Se EVAL_LOG_PATH estiver definido (não vazio), acrescenta uma linha JSON.
 * Falha de disco só loga aviso — o chat continua.
 */
export function appendEvalLog(entrada: EvalLogEntrada): void {
  const caminho = process.env.EVAL_LOG_PATH?.trim();
  if (!caminho) return;

  try {
    mkdirSync(dirname(caminho), { recursive: true });
    const linha = JSON.stringify({
      pergunta: entrada.pergunta,
      resposta: entrada.resposta,
      evidencias: entrada.evidencias.map(truncarEvidencia),
      veredito: entrada.veredito,
      fonte: entrada.fonte,
    });
    appendFileSync(caminho, `${linha}\n`, "utf8");
  } catch (err) {
    console.warn("[eval-log] falha ao gravar; chat segue:", err);
  }
}

function truncarEvidencia(e: Evidencia): Evidencia {
  return {
    tool: e.tool,
    argumentos: e.argumentos,
    resultado: truncarResultado(e.resultado),
  };
}

function truncarResultado(resultado: unknown): unknown {
  if (typeof resultado === "string") {
    return resultado.length > LIMITE_RESULTADO ? resultado.slice(0, LIMITE_RESULTADO) : resultado;
  }
  let json: string;
  try {
    json = JSON.stringify(resultado);
  } catch {
    json = String(resultado);
  }
  if (json.length <= LIMITE_RESULTADO) return resultado;
  return json.slice(0, LIMITE_RESULTADO);
}
