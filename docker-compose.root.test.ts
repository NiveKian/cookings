import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;
const mainPath = join(ROOT, "docker-compose.yml");
const overridePath = join(ROOT, "docker-compose.override.yml");
const mainText = readFileSync(mainPath, "utf8");
const overrideText = readFileSync(overridePath, "utf8");

const INCLUDES = [
  "services/docker-compose.yml",
  "mcp/docker-compose.yml",
  "app/docker-compose.yml",
  "ollama/docker-compose.yml",
];

function yamlBodyWithoutComments(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

function assertNoSecrets(text: string) {
  const apiKeyPatterns = [
    /\bAIza[A-Za-z0-9_-]{20,}/,
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /\b(xox[baprs]-[A-Za-z0-9-]{20,})/,
    /(GEMINI|OPENAI|CLAUDE|ANTHROPIC)_API_KEY:\s*["']?[A-Za-z0-9._-]{8,}/i,
  ];
  for (const re of apiKeyPatterns) {
    expect(text).not.toMatch(re);
  }
  const lines = text.split(/\r?\n/);
  const passwordValue = /^\s*password:\s*.+$/i;
  const offenders = lines.filter(
    (line) => passwordValue.test(line) && !line.trim().startsWith("#"),
  );
  expect(offenders).toEqual([]);
}

describe("docker-compose.yml na raiz (include)", () => {
  test("inclui os quatro composes das subpastas", () => {
    for (const rel of INCLUDES) {
      expect(mainText).toContain(rel);
      expect(existsSync(join(ROOT, rel))).toBe(true);
    }
  });

  test("nome do projeto e sem blocos que conflitam com include", () => {
    expect(mainText).toContain("name: cookings");
    const body = yamlBodyWithoutComments(mainText);
    expect(body).not.toMatch(/^volumes:\s*$/m);
    expect(body).not.toMatch(/^services:\s*$/m);
  });

  test("não embute segredos", () => {
    assertNoSecrets(mainText);
  });
});

describe("docker-compose.override.yml na raiz", () => {
  test("volumes com nome fixo", () => {
    expect(overrideText).toContain("cookings_pgdata");
    expect(overrideText).toContain("cookings_cache");
    expect(overrideText).toContain("cookings_ollama");
    expect(overrideText).toMatch(/cookings_pgdata:\s*\n\s*name:\s*cookings_pgdata/);
    expect(overrideText).toMatch(/cookings_cache:\s*\n\s*name:\s*cookings_cache/);
    expect(overrideText).toMatch(/cookings_ollama:\s*\n\s*name:\s*cookings_ollama/);
  });

  test("ordem de subida: MCP, app e pull do Ollama", () => {
    expect(overrideText).toContain("service_completed_successfully");
    expect(overrideText).toContain("ollama_pull");
    expect(overrideText).toContain("OLLAMA_BASE_URL");
    expect(overrideText).toContain("http://ollama:11434");
    expect(overrideText).toContain("service_cursos");
    expect(overrideText).toContain("service_matriculas");
    expect(overrideText).toContain("service_receitas");
    expect(overrideText).toContain("mcp_cursos");
    expect(overrideText).toContain("mcp_matriculas");
    expect(overrideText).toContain("mcp_receitas");
  });

  test("não embute segredos", () => {
    assertNoSecrets(overrideText);
  });
});