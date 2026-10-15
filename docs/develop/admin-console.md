# Admin console (`apps/admin`)

The operator console lives in `apps/admin` — a standalone Next.js app that is
deployed as its own Vercel project (`overlay-admin`) on `admin.getoverlay.io`
(Stage 3, per `docs/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md`). It replaces the
in-app `/app/admin` surface, which stays in place until Stage 3.

## Status

- Stages 1/2: standalone app and dedicated Convex operator endpoints implemented; integration QA in progress.
- Stage 3: separate `overlay-admin` project created; domain, WorkOS and environment activation are being verified. The web admin remains until authenticated standalone acceptance passes.

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
- `ADMIN_API_SECRET` — the dev backend's `ADMIN_API_SECRET` value (set on the
  Convex deployment; distinct from `INTERNAL_API_SECRET` so the web app's
  secret cannot call the operator surface). Each PR preview/dev backend needs
  it set via `npx convex env set ADMIN_API_SECRET <value>` — preview
  provisioning does not set it automatically.
- `ADMIN_ALLOWED_USER_IDS` — your WorkOS user id
- `COMPOSIO_API_KEY` — optional; powers the live third-party catalog list

The WorkOS AuthKit redirect URI must be `<origin>/auth/callback`. Chrome
drops `__Host-`-prefixed cookies on plain `http://localhost`, so local dev
needs HTTPS: `PORT=3100 npx next dev --experimental-https` inside
`apps/admin` (self-signed cert, accept the warning once).

## Architecture

- `src/server/convex-admin.ts` is the **only** module that talks to Convex. It
  injects `ADMIN_API_SECRET` as `serverSecret` on every call, forwards the
  operator's WorkOS access token as `Authorization: Bearer`, and calls the
  `admin/console:*` functions over the Convex HTTP API.
- Convex-side gate (`convex/admin/console.ts`): every function runs
  `requireAdminSecret` (constant-time `ADMIN_API_SECRET` compare, fails closed
  when unset) plus `requireOperator` (`convex/lib/auth.ts`), which resolves the
  caller's WorkOS identity via Convex auth (`convex/auth.config.ts`, WorkOS
  JWKS customJwt providers) and requires an active `administrativePrincipals`
  row with a permitted role — writes require `admin`, reads any active
  operator, audit list `admin`/`auditor`, user directory `admin`/`billing_admin`/`support`.
  Every write records its own `auditEvents` row in the same transaction.
  `admin/administration:*`, `admin/authorization:*`, and
  `auth/users:listUserDirectoryByServer` stay on `INTERNAL_API_SECRET` for the
  web app until Stage 3.
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
- `ADMIN_API_SECRET` may only be referenced inside
  `apps/admin/src/server/env.ts` (asserted by `client-boundary.test.ts`).
- No `'use client'` module may import `src/server/**` or `convex-admin`
  (also covered by `src/client-boundary.test.ts`).

## Break-glass recovery

When no active `admin` principal exists (first operator, accidental mass
revoke), grant one directly with deployment access:

```bash
npx convex run admin/breakGlass:grantFirstAdmin '{"userId": "user_..."}'
```

`grantFirstAdmin` is an internal mutation — unreachable by app secrets — and
records an `administration.principal.break_glass_grant` audit event.

## Security headers

`src/proxy.ts` sets the CSP per request with a nonce (`default-src 'self'`,
`connect-src` limited to Convex + WorkOS) — a static `script-src 'self'`
blocks Next's inline RSC bootstrap scripts and kills hydration, so Next
stamps the nonce onto its own scripts instead. `next.config.ts` keeps the
nonce-independent headers: `frame-ancestors 'none'` (also inside the CSP),
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Robots-Tag:
noindex, nofollow`, and `poweredByHeader: false`. `apps/admin/vercel.json`
allows native main production deployments and disables automatic non-main builds.

## CI

`.github/workflows/admin.yml` runs typecheck, lint, tests, and `next build` on
PRs and merge groups touching `apps/admin` or its workspace deps.

## Integration hardening

Operator capabilities derive from the active administrative principal inside the admin app, independently of customer workspace role assignments. First-operator grants need no customer-role bootstrap. AuthKit sign-in requests `max_age=0`; mutations use the access token's `auth_time`, never callback or refresh time, for the 30-minute freshness check. Return destinations are normalized and constrained to the admin origin at both ends of OAuth.

Admin lint/typecheck/build run as a reusable workflow called by Security Checks; the exhaustive shards execute every admin test under its own tsconfig once; the required quality aggregate fails if admin validation fails, is absent or is skipped. Separate import-boundary rule IDs preserve existing web architecture restrictions.

## Token propagation and release safety

Authenticated handlers and their error/audit paths share the same operator token context. The page derives capabilities from the principal and does not issue an unscoped permission request. Mutations require same-origin requests, valid JSON/enum/capability inputs and recent WorkOS authentication. Billing and support directory role policy is explicit in the backend.

WorkOS native Convex verification follows the [official AuthKit configuration](https://docs.convex.dev/auth/authkit/): shared issuers require the client audience; client-scoped issuers use client-specific JWKS and do not require an absent audience claim. Fresh authentication follows [WorkOS reauthentication](https://workos.com/docs/authkit/reauthentication).

Keep admin production settings limited to its Convex URL, dedicated admin API/session secrets, production WorkOS credentials and the owner's explicit operator allowlist. Never allowlist the release-QA or demo identity in production. Preview uses separate secrets and test identities. Credentials have no scheduled expiry.
