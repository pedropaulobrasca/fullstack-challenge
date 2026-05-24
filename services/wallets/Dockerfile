FROM oven/bun:1.3.11-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY frontend/package.json ./frontend/
COPY services/games/package.json ./services/games/
COPY services/wallets/package.json ./services/wallets/
RUN bun install --frozen-lockfile

FROM deps AS migrate
WORKDIR /app/services/wallets
COPY services/wallets ./
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
CMD ["bunx", "mikro-orm", "migration:up"]

FROM deps AS runtime
WORKDIR /app/services/wallets
COPY services/wallets ./
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV NODE_ENV=production
EXPOSE 4002
CMD ["bun", "run", "src/main.ts"]
