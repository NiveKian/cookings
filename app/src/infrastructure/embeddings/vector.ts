// Operações de vetor usadas pelos adapters de embedding e pelo cache.
// Cosseno = produto escalar quando os dois vetores já estão L2-normalizados.

export const DIMENSOES_MOCK = 256;

export function l2Normalizar(vetor: number[]): number[] {
  let soma = 0;
  for (const x of vetor) soma += x * x;
  const norma = Math.sqrt(soma);
  if (norma === 0) return vetor.map(() => 0);
  return vetor.map((x) => x / norma);
}

export function produtoEscalar(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
