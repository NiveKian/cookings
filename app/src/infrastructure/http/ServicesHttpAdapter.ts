import type { CursosServicePort, MatriculasServicePort, ReceitasServicePort } from "../../domain/ports/ServicePorts";
import type { Aluno, Aula, Curso, Ingrediente, Matricula, Receita } from "../../domain/entities";

// Adapters que implementam as portas de services fazendo fetch direto do
// navegador para os service_* (REST), sem passar por IA ou MCP — usados
// pela aba "Informações". As URLs vêm de variáveis VITE_* (injetadas em
// build/dev pelo Vite), configuráveis no .env do app.

const CURSOS_URL = import.meta.env.VITE_SERVICE_CURSOS_URL ?? "http://localhost:3001";
const MATRICULAS_URL = import.meta.env.VITE_SERVICE_MATRICULAS_URL ?? "http://localhost:3002";
const RECEITAS_URL = import.meta.env.VITE_SERVICE_RECEITAS_URL ?? "http://localhost:3003";

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Falha ao buscar ${url}: HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

function withQuery(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export class CursosHttpAdapter implements CursosServicePort {
  async listCursos(filtros?: { categoria?: string; nivel?: string }): Promise<Curso[]> {
    return getJson<Curso[]>(withQuery(`${CURSOS_URL}/cursos`, filtros ?? {}));
  }

  async listAulas(cursoId: string): Promise<Aula[]> {
    return getJson<Aula[]>(`${CURSOS_URL}/cursos/${cursoId}/aulas`);
  }
}

export class MatriculasHttpAdapter implements MatriculasServicePort {
  async listAlunos(): Promise<Aluno[]> {
    return getJson<Aluno[]>(`${MATRICULAS_URL}/alunos`);
  }

  async listMatriculas(filtros?: { alunoId?: string; cursoId?: string }): Promise<Matricula[]> {
    return getJson<Matricula[]>(
      withQuery(`${MATRICULAS_URL}/matriculas`, { alunoId: filtros?.alunoId, cursoId: filtros?.cursoId })
    );
  }
}

export class ReceitasHttpAdapter implements ReceitasServicePort {
  async listReceitas(filtros?: { cursoId?: string }): Promise<Receita[]> {
    return getJson<Receita[]>(withQuery(`${RECEITAS_URL}/receitas`, { cursoId: filtros?.cursoId }));
  }

  async getReceita(id: string): Promise<Receita> {
    return getJson<Receita>(`${RECEITAS_URL}/receitas/${id}`);
  }

  async listIngredientes(): Promise<Ingrediente[]> {
    return getJson<Ingrediente[]>(`${RECEITAS_URL}/ingredientes`);
  }
}
