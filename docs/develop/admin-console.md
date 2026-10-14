# Admin console app (`apps/admin`)

The operator console for Overlay deployments, implemented as a standalone
Next.js app in `apps/admin`. It replaces the in-app `/app/admin` surface; per
`docs/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md` Stage 1 adds the app alongside
the existing one (nothing is removed from `src/` yet — Stage 3 retires the
in-app copy).

## What it is

- **One deployable app** — its own Vercel project in Stage 3
  (`admin.getoverlay.io`), its own session cookie
  (`__Host-overlay_admin_session`), its own Convex secret
  (`ADMIN_API_SECRET`; `ADMIN_CONVEX_SECRET` in local dev), and its own
  npm workspace `@overlay/admin`.
- **Same four sections as today's console**: Overview (people + audit),
  Roles, Groups, Catalog policies — ported verbatim from
  `src/app/app/admin/page.tsx`, `src/features/admin/*`,
  `src/app/api/v1/admin/*`, `src/server/admin/*`, and the authorization
  service stack.
- **Own auth boundary**: WorkOS sign-in at `/auth/workos` → `/auth/callback`,
  then a three-part gate on every page and API route — valid session cookie,
  `ADMIN_ALLOWED_USER_IDS` membership, and an active `administrativePrincipals`
  row.

## Running it locally

```bash
cp apps/admin/.env.example apps/admin/.env.local   # fill in values
npm run admin:dev                                 # → http://localhost:3000
```

Env vars (plain language):

| Var | Meaning |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Prod Convex deployment (or your dev backend). |
| `DEV_NEXT_PUBLIC_CONVEX_URL` | Optional dev override — used when `NODE_ENV=development`. |
| `ADMIN_CONVEX_SECRET` | Local dev: your dev backend's `INTERNAL_API_SECRET` value. Deployed environments set `ADMIN_API_SECRET` instead. |
| `ADMIN_SESSION_SECRET` | HMAC key for the admin session cookie (`openssl rand -base64 32`). Separate from the web `SESSION_SECRET` on purpose. |
| `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` | Same WorkOS environment as the web app; add `<admin-origin>/auth/callback` as a redirect URI. |
| `ADMIN_ALLOWED_USER_IDS` | Comma-separated WorkOS user ids allowed past the sign-in gate. |

For a smoke without Convex creds, `npm run admin:dev` and open `/signin` —
the gate redirects unauthenticated visitors there, so the sign-in card must
render without any env set.

## Invariants (enforced by ESLint + `admin-boundary.test.ts`)

- `apps/admin` never imports the customer `src/**` tree (and vice versa);
  shared code goes through `packages/*`.
- `src/server/convex-admin.ts` is the **only** module that reads
  `ADMIN_CONVEX_SECRET`/`ADMIN_API_SECRET` and the only Convex client; every
  repository calls `convexAdmin.query/mutation` with `serverSecret`.
- No web-app or provider secrets (`INTERNAL_API_SECRET`, `SESSION_SECRET`,
  `STRIPE_*`, `COMPOSIO_API_KEY`, …) are read anywhere in the app.
- Security headers: `default-src 'self'` CSP (Convex + WorkOS connect-src),
  `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy:
  no-referrer`, `X-Robots-Tag: noindex, nofollow`.
- `apps/admin/vercel.json` sets `git.deploymentEnabled.main=false` (the app's
  release is operator-driven, like the web app's).

## Commands

`npm run admin:dev` · `admin:typecheck` · `admin:lint` · `admin:test` ·
`admin:build` — all run inside `apps/admin` from the repo root. CI
(`.github/workflows/admin-app.yml`) runs the same four on PRs touching the
app and on the merge queue.

## Known Stage 1 limitations

- The catalog route omits the live Composio provider catalog (it needs
  `COMPOSIO_API_KEY`, which the admin app never holds; the web route already
  fail-softs to `[]`). Connector resources come from the static app-shell
  registry only.
- The web app keeps its own `/app/admin` + `/api/v1/admin/*` until Stage 3;
  the two consoles read/write the same Convex data.
- `@overlay/api-client` is not used (it reaches into web `src/**`); the app
  ships a thin `src/shared/app/admin-api-client.ts` with the same method
  surface for the ported panels.
