# syntax=docker/dockerfile:1
# docs MCP server image, with the synthetic document store built in (it is generated, so the image
# is the store; nothing is mounted). Build from the repo root:
#   docker build -f apps/mcp-docs/Dockerfile .      (scripts/local/build-push.sh mcp-docs does this)

ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

# ---------- build: install, compile, generate the documents, copy only production files ----------
FROM ${NODE_IMAGE} AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm fetch --store-dir /pnpm-store

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm-store
RUN pnpm exec tsc -b apps/mcp-docs
# Same generator and seed as the ERP seed, so documents and database rows agree.
RUN node agents/general/invoice-exception-resolver/dist/data/cli.js /generated
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @agents/mcp-docs deploy --prod --legacy --store-dir /pnpm-store /out

# ---------- runtime: compiled server and the read-only document store, as a non-root user ----------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production DOCS_ROOT=/docs PORT=8080
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /generated/docs /docs
# The matching ERP seed, outside the store (no tool can read it). The apply scripts load it into
# Postgres with "kubectl exec deploy/mcp-docs -- cat /seed/seed.sql". Eval labels are not copied.
COPY --from=build /generated/seed.sql /seed/seed.sql
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/main.js"]
