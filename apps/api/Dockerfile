# syntax=docker/dockerfile:1
# Portal image: the API (apps/api) serving the built web UI (apps/web) as static files (ADR-0013).
# Build from the repo root:  docker build -f apps/api/Dockerfile .   (scripts/local/build-push.sh api)

ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

# ---------- build: install, compile the API, build the UI, copy only production files ----------
FROM ${NODE_IMAGE} AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm fetch --store-dir /pnpm-store

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm-store
RUN pnpm exec tsc -b apps/api && pnpm --filter @agents/web build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @agents/api deploy --prod --legacy --store-dir /pnpm-store /out
RUN cp -r apps/web/dist /out/web

# ---------- runtime ----------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=8080 WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /out /app
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/main.js"]
