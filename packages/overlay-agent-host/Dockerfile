FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/overlay
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --omit=dev --workspace=@layernorm/overlay-agent-host --include-workspace-root=false \
  && ln -s /opt/overlay/packages/overlay-agent-host/src/cli.mjs /usr/local/bin/overlay-agent-host \
  && chmod +x /opt/overlay/packages/overlay-agent-host/src/cli.mjs \
  && mkdir -p /workspace /var/lib/overlay-agent-host \
  && chown -R node:node /workspace /var/lib/overlay-agent-host

USER node
WORKDIR /workspace
ENTRYPOINT ["overlay-agent-host"]
CMD ["run", "--config", "/etc/overlay-agent-host/config.json"]
