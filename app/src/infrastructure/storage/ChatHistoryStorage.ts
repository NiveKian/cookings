import type { ChatCacheMeta, ChatJudgeMeta, ChatMessage } from "../../domain/entities";

// Persistência opcional do histórico do chat em localStorage. Projetada
// para NUNCA quebrar o chat se o navegador não suportar/permitir
// localStorage (modo privado, iframe sandboxado, política de cookies
// restritiva, etc.) — todo acesso é protegido por try/catch, e qualquer
// falha simplesmente desativa a persistência (o chat continua funcionando
// só na memória, como antes).

const STORAGE_KEY = "cookings:chat-history";
const CONSENT_KEY = "cookings:chat-history-consent";

// Testa se localStorage realmente funciona neste navegador (só "existir"
// não basta — em modo privado de alguns navegadores ele existe mas lança
// erro ao usar).
function isStorageWorking(): boolean {
  try {
    const testKey = "__cookings_storage_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pergunta ao usuário (via popup nativo do navegador — funciona em
 * qualquer um, sem depender de CSS/biblioteca) se ele permite salvar o
 * histórico do chat localmente. A resposta é lembrada (em localStorage)
 * para não perguntar de novo a cada recarregamento da página.
 *
 * Retorna `true` somente se: localStorage funciona NESTE navegador E o
 * usuário já consentiu (agora ou numa visita anterior). Em qualquer outro
 * caso — sem suporte, erro inesperado, ou usuário recusou — retorna
 * `false` e a persistência fica desativada.
 */
export function initChatPersistence(): boolean {
  try {
    if (typeof window === "undefined" || !isStorageWorking()) {
      return false;
    }

    const jaRespondeu = window.localStorage.getItem(CONSENT_KEY);
    if (jaRespondeu === "granted") return true;
    if (jaRespondeu === "denied") return false;

    const aceitou = window.confirm(
      "O Cookings pode salvar o histórico do chat neste navegador (localStorage), " +
        "assim ele não some ao recarregar a página. Deseja permitir?"
    );

    try {
      window.localStorage.setItem(CONSENT_KEY, aceitou ? "granted" : "denied");
    } catch {
      // Não conseguiu nem gravar a preferência — segue sem persistir,
      // mas não derruba o app por causa disso.
    }

    return aceitou;
  } catch {
    return false;
  }
}

/** Lê o histórico salvo. Retorna null se não houver nada salvo ou se algo falhar. */
export function loadChatHistory(): ChatMessage[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parseChatHistory(parsed);
  } catch {
    return null;
  }
}

/**
 * Aceita o formato antigo `{role, content}` e o novo com cache/judge opcionais.
 * Item sem role/content válido é ignorado; array vazio ou lixo vira null.
 */
export function parseChatHistory(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;

  const mensagens: ChatMessage[] = [];
  for (const item of raw) {
    const msg = parseMensagem(item);
    if (msg) mensagens.push(msg);
  }
  return mensagens.length > 0 ? mensagens : null;
}

function parseMensagem(item: unknown): ChatMessage | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (o.role !== "user" && o.role !== "assistant") return null;
  if (typeof o.content !== "string") return null;

  const msg: ChatMessage = { role: o.role, content: o.content };
  const cache = parseCache(o.cache);
  if (cache) msg.cache = cache;
  const judge = parseJudge(o.judge);
  if (judge) msg.judge = judge;
  return msg;
}

function parseCache(raw: unknown): ChatCacheMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.usado !== "boolean" || typeof o.motivo !== "string") return undefined;
  const cache: ChatCacheMeta = { usado: o.usado, motivo: o.motivo };
  if (typeof o.similaridade === "number" && Number.isFinite(o.similaridade)) {
    cache.similaridade = o.similaridade;
  }
  return cache;
}

function parseJudge(raw: unknown): ChatJudgeMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (o.status !== "ok" && o.status !== "unavailable") return undefined;
  if (o.veredito !== "aprovar" && o.veredito !== "revisar" && o.veredito !== "reprovar") {
    return undefined;
  }
  const notas = parseNotas(o.notas);
  if (!notas) return undefined;
  return { status: o.status, veredito: o.veredito, notas };
}

function parseNotas(raw: unknown): ChatJudgeMeta["notas"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const campos = ["fidelidade", "coerencia", "seguranca", "relevancia", "clareza"] as const;
  const notas: ChatJudgeMeta["notas"] = {
    fidelidade: 0,
    coerencia: 0,
    seguranca: 0,
    relevancia: 0,
    clareza: 0,
  };
  for (const c of campos) {
    if (typeof o[c] !== "number" || !Number.isFinite(o[c])) return undefined;
    notas[c] = o[c];
  }
  return notas;
}

/** Salva o histórico. Falha silenciosamente (nunca quebra o chat por causa disso). */
export function saveChatHistory(messages: ChatMessage[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // Ignorado de propósito — ver comentário no topo do arquivo.
  }
}

/** Apaga o histórico salvo (útil para um botão "Limpar conversa", se quiser adicionar depois). */
export function clearChatHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignorado de propósito.
  }
}