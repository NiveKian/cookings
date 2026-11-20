import { describe, expect, test } from "bun:test";
import { sanitizeSchema } from "./GeminiAdapter";

describe("sanitizeSchema", () => {
  test("inlina $ref de $defs e não deixa $ref/$defs no resultado", () => {
    const schema = {
      type: "object",
      title: "x",
      $defs: {
        IngredienteGerado: {
          type: "object",
          title: "IngredienteGerado",
          properties: { nome: { type: "string" } },
          additionalProperties: false,
        },
      },
      properties: {
        ingredientes: { type: "array", items: { $ref: "#/$defs/IngredienteGerado" } },
      },
    };
    const out = sanitizeSchema(schema) as any;
    expect(out.properties.ingredientes.items.properties.nome.type).toBe("string");
    expect(out.properties.ingredientes.items.type).toBe("object");
    const json = JSON.stringify(out);
    expect(json).not.toContain("$ref");
    expect(json).not.toContain("$defs");
  });

  test("preserva description irmã do $ref", () => {
    const out = sanitizeSchema({
      $defs: { A: { type: "string", description: "da def" } },
      properties: { a: { $ref: "#/$defs/A", description: "irmã" } },
    }) as any;
    expect(out.properties.a.type).toBe("string");
    expect(out.properties.a.description).toBe("irmã");
  });

  test("ref cíclico não entra em loop", () => {
    const out = sanitizeSchema({
      $defs: {
        No: { type: "object", properties: { filho: { $ref: "#/$defs/No" } } },
      },
      properties: { raiz: { $ref: "#/$defs/No" } },
    }) as any;
    expect(out.properties.raiz.properties.filho).toEqual({ type: "object" });
    expect(JSON.stringify(out)).not.toContain("$ref");
  });

  test("continua removendo title, additionalProperties, $schema e default", () => {
    const out = sanitizeSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "t",
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string", default: "x", title: "A" } },
    }) as any;
    expect(out).toEqual({ type: "object", properties: { a: { type: "string" } } });
  });
});
