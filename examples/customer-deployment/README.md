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
  convex.env.example            # backend env contract
  bin/convex-bootstrap.sh       # first-run: admin key + deploy + secrets
  helm/values.yaml
```

Add customer-owned extension packages under `extensions/`, then register them in `overlay.config.ts` through `extendOverlayAppConfig`.

## Self-hosted Convex backend

Enterprise customers who own the backend end-to-end (data sovereignty, no Convex Cloud dependency) run `docker-compose.convex.yml` alongside the app compose. It brings up the official open-source Convex backend with PostgreSQL persistence and S3-compatible storage — full feature parity with Convex Cloud. See `docs/deploy-operate/self-hosted-convex.mdx` for the operations runbook.

## Update Model

Enterprise IT keeps the extension code local, then periodically bumps the Overlay version:

```bash
npm ci
npm run extension-sdk:test
npm run extension-sdk:typecheck
npm run typecheck
```

If the extension only uses SDK contracts and shell primitives, product updates should usually be dependency bumps instead of merge-heavy source edits.
