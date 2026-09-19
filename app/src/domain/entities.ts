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

export interface ChatMessage {
  role: ChatRole;
  content: string;
}
