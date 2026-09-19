# `app/` — Cookings

Cliente React + Vite + TailwindCSS, com **arquitetura hexagonal**, e um pequeno backend em **Bun + Hono** que orquestra a conversa com a IA e a execução das tools MCP. Ver `GUIA_LLM.md` (raiz do projeto) para o contexto arquitetural completo.

## Duas Abas

- **Informações**: consome os `service_*` (pasta `services/`) **diretamente do navegador**, via `fetch` — sem passar por IA ou MCP. Lista cursos, alunos e receitas.
- **Chatbot**: envia a mensagem do usuário para `POST /api/chat` (backend deste próprio app), que conversa com o provedor de IA configurado e, quando necessário, executa tools reais nos 3 servidores MCP (`mcp_cursos`, `mcp_matriculas`, `mcp_receitas`) até ter uma resposta final.

## Por Que Há um Backend Aqui

O `app` é uma SPA, mas chamadas a LLMs (com chave de API) e a orquestração de tool-calling contra os servidores MCP **precisam** rodar no servidor — nunca no navegador (a chave vazaria, e MCP via `streamable-http` server-to-server é o padrão já definido no `GUIA_LLM.md`). Por isso, além do front, este projeto tem um `server.ts` (Bun + Hono) que:
1. Serve o build estático do Vite (`dist/`) em produção.
2. Expõe `POST /api/chat`, onde mora toda a lógica de IA + MCP.

## Arquitetura Hexagonal

```
src/
├── domain/
│   ├── entities.ts          # Curso, Aluno, Matricula, Receita, ChatMessage...
│   └── ports/
│       ├── LLMPort.ts        # contrato que Gemini/Claude/GPT/Mock implementam
│       ├── ToolsPort.ts      # contrato de descoberta/execução de tools MCP
│       └── ServicePorts.ts   # contrato de leitura dos services (aba Informações)
│
├── application/
│   ├── chat/sendChatMessage.ts   # caso de uso: loop de tool-calling
│   └── info/infoQueries.ts       # casos de uso finos da aba Informações
│
├── infrastructure/
│   ├── llm/
│   │   ├── GeminiAdapter.ts   ┐
│   │   ├── ClaudeAdapter.ts   ├─ implementam LLMPort
│   │   ├── GptAdapter.ts      ┤  (fetch direto às APIs, sem SDK pesado)
│   │   ├── MockAdapter.ts     ┘  (bônus: testes offline, ver abaixo)
│   │   └── llmFactory.ts      # único ponto de troca de provedor (LLM_PROVIDER no .env)
│   ├── mcp/McpToolsAdapter.ts # implementa ToolsPort, conecta aos 3 servidores MCP
│   └── http/ServicesHttpAdapter.ts # implementa ServicePorts, fetch do navegador
│
└── ui/
    ├── App.tsx            # abas
    ├── InfoTab/InfoTab.tsx
    └── ChatTab/ChatTab.tsx
```

Trocar de provedor de IA é mudar **uma linha** no `.env` (`LLM_PROVIDER=gemini|claude|gpt`) — nenhum código muda, porque `application/chat/sendChatMessage.ts` só conhece a interface `LLMPort`, nunca uma implementação concreta.

## Como Rodar (Docker — recomendado)

Pressupõe que a rede `cookings-network` já existe e que `services/` e `mcp/` já estão no ar.

```bash
cp .env.example .env
# edite .env: preencha GEMINI_API_KEY (ou troque LLM_PROVIDER e a chave do provedor escolhido)

docker compose up -d --build
```

Acesse `http://localhost:3000`.

## Como Rodar (sem Docker, para desenvolvimento)

Requer Bun instalado.

```bash
bun install
cp .env.example .env
# edite .env (ao menos LLM_PROVIDER + a chave correspondente, ou use LLM_PROVIDER=mock — ver abaixo)

bun run dev
```

Isso sobe **dois processos ao mesmo tempo** (via `concurrently`): o Vite (porta `5173`, com hot reload) e o backend (porta `3000`), com o Vite fazendo proxy de `/api/*` para o backend. Acesse `http://localhost:5173`.

## Testando Sem Chave de API Real (`LLM_PROVIDER=mock`)

Como não é possível testar Gemini/Claude/GPT de verdade sem uma chave paga, este projeto inclui um 4º adapter, **`MockAdapter`**, só para desenvolvimento/demonstração (não é um dos 3 provedores exigidos pelo trabalho — é um bônus de testabilidade). Com `LLM_PROVIDER=mock` no `.env`, nenhuma chave é necessária, e o backend ainda executa tools **reais** nos servidores MCP reais.

Protocolo do mock: mande uma mensagem no formato `TOOL:<nome_da_tool>:<json_de_argumentos>` no chat (ou via `curl`) para forçar a chamada de uma tool de verdade:

```bash
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"TOOL:listar_cursos:{\"categoria\":\"Massas\"}"}]}'
```

Qualquer outra mensagem recebe apenas um eco de texto (sem chamar tools).

## O Que Já Foi Validado

- **Typecheck limpo** (`bun run typecheck`) e **build de produção do Vite** funcionando, com as URLs `VITE_SERVICE_*` corretamente embutidas no bundle estático (checado via `grep` no arquivo gerado).
- **Modo desenvolvimento**: Vite dev server sobe, compila `src/main.tsx` sob demanda, e o proxy `/api/*` → backend (porta 3000) funciona.
- **Modo produção**: `server.ts` serve `dist/index.html`, os assets estáticos (JS/CSS) e o fallback de SPA para rotas desconhecidas — tudo convivendo com as rotas `/api/*` no mesmo processo Hono.
- **`POST /api/chat` testado de ponta a ponta com `LLM_PROVIDER=mock`**, provando a cadeia completa: backend → `sendChatMessage` (caso de uso) → `LLMPort` → loop de tool-calling → `McpToolsAdapter` → os 3 servidores MCP reais → os `service_*` reais → Postgres real → resposta de volta. Testado com tools de cada um dos 3 domínios (cursos, matrículas, receitas com `JOIN` de ingredientes) na mesma sessão do backend, tool inexistente (erro tratado) e validação Zod do payload (`400` em mensagens vazias).
- **Bug real encontrado e corrigido durante o teste**: o `McpToolsAdapter` concatenava todos os blocos de conteúdo MCP antes de fazer `JSON.parse`, o que quebrava para tools que retornam listas (cada item da lista vem como um bloco MCP separado, não um array em um bloco só). Corrigido para parsear bloco a bloco e agregar em array quando há mais de um item.
- A aba **Informações** usa exatamente os mesmos endpoints REST dos `service_*` que já foram validados exaustivamente via `curl` na etapa de construção de `services/` — o `ServicesHttpAdapter` é um `fetch` direto para eles, sem lógica adicional.

## O Que NÃO Foi Validado

- **Chamadas reais a Gemini, Claude ou GPT** — não há chaves de API disponíveis neste ambiente de desenvolvimento. Os 3 adapters foram implementados seguindo a especificação pública de cada API (formato de mensagens, tool-calling/function-calling), mas **recomenda-se testar cada um com uma chave real antes de considerar essa etapa 100% encerrada.** O `MockAdapter` prova que a orquestração ao redor deles (loop de tool-calling, execução MCP, tratamento de erro) funciona corretamente — o que resta validar é especificamente o parsing da resposta de cada API.
- **Build da imagem Docker e `docker-compose.yml`** — mesmo motivo dos outros dois subprojetos: sem Docker disponível neste sandbox. O `Dockerfile` é multi-stage (build do Vite com as `VITE_*` como build args, depois só o runtime Bun + `dist/` + backend) — revalide com `docker compose up -d --build`.
- **Renderização real no navegador** (React montando, cliques, etc.) — sem um navegador neste ambiente. O que foi validado é: o bundle compila sem erros, o HTML/JS/CSS são servidos corretamente pelo backend, e todas as chamadas de rede que os componentes fazem (`fetch` para os services, `fetch` para `/api/chat`) foram testadas via `curl` batendo exatamente nos mesmos endpoints.

## Estrutura

```
app/
├── docker-compose.yml
├── Dockerfile
├── server.ts               # backend Bun/Hono: /api/chat, /api/health, serve dist/
├── src/                     # ver árvore hexagonal acima
├── index.html, vite.config.ts, tailwind.config.js, postcss.config.js
└── .env.example
```
