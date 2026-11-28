FROM oven/bun:1.4.5 AS bun

FROM node:22-bookworm AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
# bun.lock covers every workspace; their manifests must be present to install from it.
COPY apps/admin/package.json ./apps/admin/
COPY apps/chrome/package.json ./apps/chrome/
COPY apps/chrome/packages ./apps/chrome/packages
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/mobile/package.json ./apps/mobile/
# Only the web app and the workspace packages it uses.
RUN bun install --frozen-lockfile --filter getoverlay-landing

FROM node:22-bookworm AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT_MODE=standalone

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .
RUN bun run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/.next/standalone ./

USER node
EXPOSE 3000
CMD ["node", "server.js"]
