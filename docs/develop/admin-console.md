# Admin console (`apps/admin`)

The operator console lives in `apps/admin` — a standalone Next.js app that is
deployed as its own Vercel project (`overlay-admin`) on `admin.getoverlay.io`
(Stage 3, per `docs/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md`). It replaces the
in-app `/app/admin` surface, which stays in place until Stage 3.

## Status

- Stage 1 (this change): app scaffold, auth, ported UI, API routes, tests.
  Nothing deploys; the Vercel project and domain do not exist yet.
- Stage 2 (planned): Convex functions that accept `ADMIN_API_SECRET`, rotated
  secret plumbing.
- Stage 3 (planned): `overlay-admin` Vercel project, `admin.getoverlay.io`
  domain, secrets, web admin retirement.

## Access model

An operator must pass all three checks:

1. A valid WorkOS session (sign-in via AuthKit at `/auth/sign-in`, callback at
   `/auth/callback`).
2. Their WorkOS user id in `ADMIN_ALLOWED_USER_IDS` (comma-separated env var).
3. An active `administrativePrincipals` row (same table the in-app admin uses;
   `revokedAt` set = denied).

The admin session is the `__Host-overlay_admin_session` cookie — AES-256-GCM
encrypted + HMAC signed with `ADMIN_SESSION_SECRET`, 8h absolute TTL and a 30m
idle window (`src/server/session.ts`). Destructive mutations require a sign-in
within the last 30 minutes; a stale session gets `recent_sign_in_required` and
the client redirects back through WorkOS.

## Local development

```bash
npm run admin:dev        # next dev on :3100
npm run admin:typecheck
npm run admin:lint
npm run admin:test
npm run admin:build
```

Required env (same values the web app uses locally):

- `DEV_NEXT_PUBLIC_CONVEX_URL` (or `ADMIN_CONVEX_URL`/`NEXT_PUBLIC_CONVEX_URL`)
- `DEV_WORKOS_CLIENT_ID`, `DEV_WORKOS_API_KEY` (non-prefixed names also work)
- `ADMIN_SESSION_SECRET` — any random 32+ char secret for local dev
- `ADMIN_CONVEX_SECRET` — the dev backend's `INTERNAL_API_SECRET` value
  (renamed `ADMIN_API_SECRET` in Stage 2)
- `ADMIN_ALLOWED_USER_IDS` — your WorkOS user id
- `COMPOSIO_API_KEY` — optional; powers the live third-party catalog list

The WorkOS AuthKit redirect URI must be `<origin>/auth/callback`.

## Architecture

- `src/server/convex-admin.ts` is the **only** module that talks to Convex. It
  injects `ADMIN_CONVEX_SECRET` as `serverSecret` on every call and calls the
  existing `admin/administration:*`, `admin/authorization:*`, and
  `auth/users:listUserDirectoryByServer` functions over the Convex HTTP API.
- `src/server/operator.ts` `resolveOperator()` is the single gate (session →
  allowlist → principal row); every API route wraps `adminRoute()` in
  `src/server/guard.ts` which maps it to 401/403 and re-mints the idle cookie.
- `src/features/admin/` holds the ported UI (Overview, Roles, Groups, Catalog)
  copied from `src/features/admin/*`; it reads data via
  `src/shared/admin-api.ts` (the same `overlayAppClient.admin*` /
  `adminAuthorization.*` surface, pointed at this app's `/api/v1/admin/*`).
- `src/app/api/v1/admin/*` are thin route wrappers over the copied services in
  `src/server/admin/*` and `src/server/authorization/*`.

## Boundary rules (enforced by ESLint)

- `src/**` may not import `apps/admin/**`.
- `apps/admin/**` may not import `src/**` — shared code is copied or moved to
  `packages/`.
- `ADMIN_CONVEX_SECRET`/`ADMIN_API_SECRET` may only be referenced inside
  `apps/admin/src/server/convex-admin.ts`.
- No `'use client'` module may import `src/server/**` or `convex-admin`
  (also covered by `src/client-boundary.test.ts`).

## Security headers

`next.config.ts` sets a strict CSP (`default-src 'self'`, `connect-src`
limited to Convex + WorkOS), `frame-ancestors 'none'`, `X-Frame-Options:
DENY`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, and
`Strict-Transport-Security`. `apps/admin/vercel.json` disables all Git
deployments until Stage 3 wires the project.

## CI

`.github/workflows/admin.yml` runs typecheck, lint, tests, and `next build` on
PRs and merge groups touching `apps/admin` or its workspace deps.
