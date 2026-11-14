// Cópia do mapa de acentos de services/service_receitas/src/texto.ts.
// Não importe do service: o app não depende dele. Não edite um sem o outro.

export const ACENTOS_DE = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
export const ACENTOS_PARA = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN";

const MAPA = new Map<string, string>(
  Array.from(ACENTOS_DE).map((letra, i) => [letra, ACENTOS_PARA[i]] as [string, string])
);

// Remove acentos (á→a, ç→c, ñ→n...) e converte para minúsculo.
export function semAcento(texto: string): string {
  let saida = "";
  for (const letra of texto) saida += MAPA.get(letra) ?? letra;
  return saida.toLowerCase();
}
