import type { CursosServicePort, MatriculasServicePort, ReceitasServicePort } from "../../domain/ports/ServicePorts";

// Casos de uso finos para a aba "Informações" — mantêm a UI desacoplada
// dos adapters concretos (ela só conhece estas funções, nunca
// ServicesHttpAdapter diretamente).

export const listarCursos = (port: CursosServicePort, filtros?: { categoria?: string; nivel?: string }) =>
  port.listCursos(filtros);

export const listarAulas = (port: CursosServicePort, cursoId: string) => port.listAulas(cursoId);

export const listarAlunos = (port: MatriculasServicePort) => port.listAlunos();

export const listarMatriculas = (port: MatriculasServicePort, filtros?: { alunoId?: string; cursoId?: string }) =>
  port.listMatriculas(filtros);

export const listarReceitas = (port: ReceitasServicePort, filtros?: { cursoId?: string }) =>
  port.listReceitas(filtros);

export const obterReceita = (port: ReceitasServicePort, id: string) => port.getReceita(id);

export const listarIngredientes = (port: ReceitasServicePort) => port.listIngredientes();
