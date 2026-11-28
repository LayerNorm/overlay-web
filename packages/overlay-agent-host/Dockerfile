FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY --from=oven/bun:1.4.5 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /opt/overlay
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
# bun.lock covers every workspace; their manifests must be present to install from it.
COPY apps/admin/package.json ./apps/admin/
COPY apps/chrome/package.json ./apps/chrome/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/mobile/package.json ./apps/mobile/
RUN bun install --frozen-lockfile --production --filter @layernorm/overlay-agent-host \
  && ln -s /opt/overlay/packages/overlay-agent-host/src/cli.mjs /usr/local/bin/overlay-agent-host \
  && chmod +x /opt/overlay/packages/overlay-agent-host/src/cli.mjs \
  && mkdir -p /workspace /var/lib/overlay-agent-host \
  && chown -R node:node /workspace /var/lib/overlay-agent-host

USER node
WORKDIR /workspace
ENTRYPOINT ["overlay-agent-host"]
CMD ["run", "--config", "/etc/overlay-agent-host/config.json"]
