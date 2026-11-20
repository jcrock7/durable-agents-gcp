# syntax=docker/dockerfile:1
# match-engine MCP server image (also runs the HPA load test: node dist/load-test.js).
# Build from the repo root:  docker build -f apps/mcp-match-engine/Dockerfile .
# (scripts/local/build-push.sh mcp-match-engine does this.)

ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

# ---------- build: install, compile, then copy only production files ----------
FROM ${NODE_IMAGE} AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm fetch --store-dir /pnpm-store

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm-store
RUN pnpm exec tsc -b apps/mcp-match-engine
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @agents/mcp-match-engine deploy --prod --legacy --store-dir /pnpm-store /out

# ---------- runtime: production dependencies and compiled code, as a non-root user ----------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out /app
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/main.js"]
