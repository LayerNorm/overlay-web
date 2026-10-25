FROM golang:1.26-alpine AS cliproxy-build
RUN apk add --no-cache git
WORKDIR /src
RUN revision=bc064340 \
  && revision="${revision}5a1d0adf" \
  && revision="${revision}77dd0f10" \
  && revision="${revision}9972ac33" \
  && revision="${revision}13d66397" \
  && git init \
  && git remote add origin https://github.com/router-for-me/CLIProxyAPI.git \
  && git fetch --depth 1 origin "${revision}" \
  && git checkout --detach FETCH_HEAD
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/cli-proxy-api ./cmd/server

FROM node:22-alpine
ENV NODE_ENV=production \
    CLIPROXYAPI_BIN=/usr/local/bin/cli-proxy-api \
    OVERLAY_SUBSCRIPTION_BROKER_HOST=0.0.0.0 \
    OVERLAY_SUBSCRIPTION_RUNTIME_DIR=/run/overlay-subscription-broker \
    OVERLAY_SUBSCRIPTION_STATE_DIR=/var/lib/overlay-subscription-broker
WORKDIR /app
COPY --from=cliproxy-build /out/cli-proxy-api /usr/local/bin/cli-proxy-api
COPY packages/overlay-subscription-broker/package.json packages/overlay-subscription-broker/server.mjs ./
RUN chmod 0755 /usr/local/bin/cli-proxy-api && mkdir -p /run/overlay-subscription-broker /var/lib/overlay-subscription-broker && chown -R node:node /app /run/overlay-subscription-broker /var/lib/overlay-subscription-broker
USER node
EXPOSE 8088
CMD ["node", "server.mjs"]
