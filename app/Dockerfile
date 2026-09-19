FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install

COPY . .

# Variáveis VITE_* precisam existir no ambiente durante o build, pois o
# Vite as embute no bundle estático nesse momento (o navegador nunca lê
# .env em runtime). Valores vêm de docker-compose.yml -> build.args,
# que por sua vez lê o .env desta pasta automaticamente.
ARG VITE_SERVICE_CURSOS_URL=http://localhost:3001
ARG VITE_SERVICE_MATRICULAS_URL=http://localhost:3002
ARG VITE_SERVICE_RECEITAS_URL=http://localhost:3003
ENV VITE_SERVICE_CURSOS_URL=$VITE_SERVICE_CURSOS_URL
ENV VITE_SERVICE_MATRICULAS_URL=$VITE_SERVICE_MATRICULAS_URL
ENV VITE_SERVICE_RECEITAS_URL=$VITE_SERVICE_RECEITAS_URL

RUN bun run build

# ---------------------------------------------------------------------

FROM oven/bun:1
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

COPY --from=build /app/dist ./dist
COPY server.ts ./
COPY src ./src

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
