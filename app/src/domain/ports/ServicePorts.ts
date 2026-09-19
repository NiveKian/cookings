import type { Aluno, Aula, Curso, Ingrediente, Matricula, Receita } from "../entities";

// Portas usadas pela aba "Informações" para ler dados diretamente dos
// services (REST), sem passar por IA ou MCP. Implementadas em
// infrastructure/http/ServicesHttpAdapter.ts.

export interface CursosServicePort {
  listCursos(filtros?: { categoria?: string; nivel?: string }): Promise<Curso[]>;
  listAulas(cursoId: string): Promise<Aula[]>;
}

export interface MatriculasServicePort {
  listAlunos(): Promise<Aluno[]>;
  listMatriculas(filtros?: { alunoId?: string; cursoId?: string }): Promise<Matricula[]>;
}

export interface ReceitasServicePort {
  listReceitas(filtros?: { cursoId?: string }): Promise<Receita[]>;
  getReceita(id: string): Promise<Receita>;
  listIngredientes(): Promise<Ingrediente[]>;
}
