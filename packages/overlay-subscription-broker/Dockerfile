FROM golang:1.26-alpine AS cliproxy-build
RUN apk add --no-cache git
WORKDIR /src
RUN git init \
  && git remote add origin https://github.com/router-for-me/CLIProxyAPI.git \
  && git fetch --depth 1 origin bc0643405a1d0adf77dd0f109972ac3313d66397 \
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
COPY packages/overlay-subscription-broker/package.json \
  packages/overlay-subscription-broker/server.mjs \
  packages/overlay-subscription-broker/state.mjs \
  packages/overlay-subscription-broker/capacity.mjs \
  packages/overlay-subscription-broker/request-validation.mjs \
  packages/overlay-subscription-broker/record-validation.mjs \
  packages/overlay-subscription-broker/persistence.mjs \
  packages/overlay-subscription-broker/worker-lifecycle.mjs \
  packages/overlay-subscription-broker/authorization.mjs \
  packages/overlay-subscription-broker/codex-authorization.mjs \
  packages/overlay-subscription-broker/management-dispatch.mjs \
  packages/overlay-subscription-broker/inference.mjs \
  ./
RUN chmod 0755 /usr/local/bin/cli-proxy-api && mkdir -p /run/overlay-subscription-broker /var/lib/overlay-subscription-broker && chown -R node:node /app /run/overlay-subscription-broker /var/lib/overlay-subscription-broker
USER node
EXPOSE 8088
CMD ["node", "server.mjs"]
