# syntax=docker/dockerfile:1
# Node server image. The hosted site uses the Cloudflare Workers preset instead;
# this image exists so self-hosters can run the app anywhere Docker runs.

# ---- build stage -----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
# Build-time defaults only; every NUXT_PUBLIC_* value can be overridden at run time.
RUN cp -n .env.example .env.production || true
ENV NITRO_PRESET=node-server
RUN pnpm build

# ---- runtime stage ---------------------------------------------------------
FROM node:22-alpine
LABEL org.opencontainers.image.title="easytv-web" \
      org.opencontainers.image.description="EasyTV creator studio" \
      org.opencontainers.image.source="https://github.com/easytv-ai/easytv-web" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3005
EXPOSE 3005
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/ >/dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
