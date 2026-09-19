import type { ChatMessage } from "../../domain/entities";

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
    if (!Array.isArray(parsed)) return null;

    return parsed as ChatMessage[];
  } catch {
    return null;
  }
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