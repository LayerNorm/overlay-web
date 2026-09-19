# Customer Deployment Template

This example shows the recommended on-prem customization shape for enterprise customers:

- Keep Overlay core pinned to an upstream version.
- Keep customer extensions in local source.
- Register pages, settings, tools, and API handlers through the extension SDK.
- Deploy the web app with customer config and local extensions bundled at build time.

## Structure

```txt
examples/customer-deployment/
  overlay.config.ts
  extensions/
  docker-compose.yml            # web app only
  docker-compose.convex.yml     # self-hosted Convex backend + Postgres + S3
  docker-compose.mirror.yml     # optional read mirror -> Postgres (BI/data lake)
  mirror/                       # mirror sidecar source + Dockerfile
  convex.env.example            # backend env contract
  bin/convex-bootstrap.sh       # first-run: admin key + deploy + secrets
  helm/values.yaml
```

Add customer-owned extension packages under `extensions/`, then register them in `overlay.config.ts` through `extendOverlayAppConfig`.

## Self-hosted Convex backend

Enterprise customers who own the backend end-to-end (data sovereignty, no Convex Cloud dependency) run `docker-compose.convex.yml` alongside the app compose. It brings up the official open-source Convex backend with PostgreSQL persistence and S3-compatible storage — full feature parity with Convex Cloud. See `docs/deploy-operate/self-hosted-convex.mdx` for the operations runbook.

## Optional: SQL read mirror

`docker-compose.mirror.yml` adds a sidecar that consumes the backend's supported streaming-export API (`list_snapshot` + `document_deltas`) and materializes every Convex table as `mirror.<table>` in Postgres — the supported surface for BI tools and data-lake ingestion. It runs one initial snapshot, then polls deltas into a durable cursor so restarts resume cleanly.

```bash
# after bin/convex-bootstrap.sh has produced .env.convex.local
docker compose \
  -f docker-compose.convex.yml -f docker-compose.mirror.yml \
  --env-file convex.env --env-file .env.convex.local \
  up -d mirror
```

Details and the table schema live in `mirror/README.md`; operations guidance is in `docs/deploy-operate/self-hosted-convex.mdx`. Never query the backend's internal `documents`/`indexes` persistence tables directly — the mirror is the supported SQL surface.

## Update Model

Enterprise IT keeps the extension code local, then periodically bumps the Overlay version:

```bash
npm ci
npm run extension-sdk:test
npm run extension-sdk:typecheck
npm run typecheck
```

If the extension only uses SDK contracts and shell primitives, product updates should usually be dependency bumps instead of merge-heavy source edits.
