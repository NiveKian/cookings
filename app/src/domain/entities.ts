// Entidades do domínio Cookings, espelhando o formato retornado pelos
// services (services/service_*). Mantidas simples de propósito.

export type Nivel = "iniciante" | "intermediario" | "avancado";

export interface Curso {
  id: string;
  titulo: string;
  descricao?: string | null;
  categoria: string;
  nivel: Nivel;
  instrutorNome: string;
  cargaHorariaHoras: number;
  preco: string;
  criadoEm: string;
}

export interface Aula {
  id: string;
  cursoId: string;
  titulo: string;
  ordem: number;
  duracaoMinutos: number;
}

export interface Aluno {
  id: string;
  nome: string;
  email: string;
  criadoEm: string;
}

export type StatusMatricula = "ativa" | "concluida" | "cancelada";

export interface Matricula {
  id: string;
  alunoId: string;
  cursoId: string;
  dataMatricula: string;
  progressoPercentual: number;
  status: StatusMatricula;
  certificadoEmitido: boolean;
}

export interface IngredienteDaReceita {
  ingredienteId: string;
  nome: string;
  unidadePadrao: string;
  quantidade: string;
  unidade: string;
  observacao?: string | null;
}

export interface Receita {
  id: string;
  cursoId: string;
  aulaId?: string | null;
  nome: string;
  modoPreparo: string;
  tempoPreparoMinutos: number;
  porcoes: number;
  ingredientes?: IngredienteDaReceita[];
}

export interface Ingrediente {
  id: string;
  nome: string;
  unidadePadrao: string;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "assistant";

/** Metadados do cache semântico; ausente em mensagens antigas e na saudação. */
export interface ChatCacheMeta {
  usado: boolean;
  motivo: string;
  similaridade?: number;
}

/** Recorte do juiz para a UI; ausente em mensagens antigas e na saudação. */
export interface ChatJudgeMeta {
  status: "ok" | "unavailable";
  veredito: "aprovar" | "revisar" | "reprovar";
  notas: {
    fidelidade: number;
    coerencia: number;
    seguranca: number;
    relevancia: number;
    clareza: number;
  };
  problemas?: Array<{ criterio: string; descricao: string; bloqueante: boolean }>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Só a mensagem do assistente depois do POST /api/chat. */
  cache?: ChatCacheMeta;
  judge?: ChatJudgeMeta;
}
