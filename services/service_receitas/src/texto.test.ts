import { describe, expect, test } from "bun:test";
import { semAcento, montarListaDeNomes } from "./texto";

describe("semAcento", () => {
  test("remove acentos minúsculos e maiúsculos", () => {
    expect(semAcento("áàâãä éèêë íìîï óòôõö úùûü çñ")).toBe("aaaaa eeee iiii ooooo uuuu cn");
    expect(semAcento("ÁÀÂÃÄ ÉÈÊË ÍÌÎÏ ÓÒÔÕÖ ÚÙÛÜ ÇÑ")).toBe("aaaaa eeee iiii ooooo uuuu cn");
  });

  test("ignora caixa", () => {
    expect(semAcento("Pimentão VERMELHO")).toBe("pimentao vermelho");
    expect(semAcento("Açúcar")).toBe(semAcento("acucar"));
  });

  test("string vazia continua vazia", () => {
    expect(semAcento("")).toBe("");
  });

  test("mantém caracteres sem acento", () => {
    expect(semAcento("farinha-de_trigo 500g")).toBe("farinha-de_trigo 500g");
  });
});

describe("montarListaDeNomes", () => {
  test("indefinido vira lista vazia", () => {
    expect(montarListaDeNomes(undefined)).toEqual([]);
    expect(montarListaDeNomes("")).toEqual([]);
    expect(montarListaDeNomes(" , ,")).toEqual([]);
  });

  test("separa por vírgula e normaliza", () => {
    expect(montarListaDeNomes("Ovos, Açúcar ,Farinha de Trigo")).toEqual([
      "ovos",
      "acucar",
      "farinha de trigo",
    ]);
  });

  test("aceita parâmetro repetido (array)", () => {
    expect(montarListaDeNomes(["Ovos", "Manteiga"])).toEqual(["ovos", "manteiga"]);
  });

  test("mistura array e vírgulas, sem duplicados", () => {
    expect(montarListaDeNomes(["Ovos,Leite", "OVOS", "Açúcar"])).toEqual(["ovos", "leite", "acucar"]);
  });
});
