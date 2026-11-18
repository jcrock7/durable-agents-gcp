# syntax=docker/dockerfile:1
# Worker image. Build from the repo root:  docker build -f apps/worker/Dockerfile .
# (scripts/local/build-push.sh and scripts/gke/build-push.sh do this.)

ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

# ---------- build: install, compile, bundle workflows, then copy only production files ----------
FROM ${NODE_IMAGE} AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Download dependencies from the lockfile alone, so this layer is cached until the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm fetch --store-dir /pnpm-store

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm-store
RUN pnpm exec tsc -b apps/worker && pnpm --filter @agents/worker run bundle
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @agents/worker deploy --prod --legacy --store-dir /pnpm-store /out

# ---------- runtime: production dependencies and compiled code, as a non-root user ----------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production WORKFLOW_BUNDLE_DIR=/app/dist/bundles
WORKDIR /app
COPY --from=build /out /app
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/main.js"]
