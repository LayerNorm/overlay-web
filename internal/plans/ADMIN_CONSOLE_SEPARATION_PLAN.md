# Admin Console Separation Plan

Status (2026-10-14): Stages 1/2 merged in #224/#225; standalone production accepted at `7997a1a41`; #230 merged at `d309cdffb` and deploying; #233 implements the final backend retirement after that web release is live.
Owner: DevelopedByDev
Workflow: [Development Workflow](https://github.com/LayerNorm/overlay-web/blob/main/internal/develop/Development%20Workflow.md). Builder threads build one PR each and stop at a
ready PR; the Integration thread reviews and merges.

## Summary

Move the Overlay operator console out of the customer web app and into its own app (`apps/admin`). It gets its own Vercel
project, the domain `admin.getoverlay.io`, its own session cookie and its own Convex secret. When this is finished, the web
app, desktop, mobile and the Chrome extension have no admin pages, no admin API routes and no admin credentials.

The work runs in three stages, in this order. Stage 1 runs in parallel with the other worktrees that are active now.

| Stage | What | Touches | Ships to users? |
| --- | --- | --- | --- |
| **1. Code** | Build `apps/admin` with the same features as today's `/app/admin` | `apps/admin/**`, root workspace config | No. Nothing deploys it yet |
| **2. Convex** | Admin-only Convex functions behind a separate secret plus a staff check; point the admin app at them | `convex/admin/**`, `convex/lib/auth.ts`, `apps/admin/**` | Additive backend only. The web app is unchanged |
| **3. Deployment** | Vercel project, domain, secrets, first production release; then remove admin from the web app and retire the old functions | Vercel, Convex env, `src/**`, `convex/admin/**` | Yes |

Removing `/app/admin` from the web app is a code change, but it waits for Stage 3. Removing it earlier would leave
production with no admin console.

Operator and workspace admin are two different jobs:

| | Operator (Overlay staff, or a self-hoster's IT team) | Workspace admin (a customer) |
| --- | --- | --- |
| Scope | The whole deployment, across every workspace and surface | One workspace |
| Today | `/app/admin` inside the workspace sidebar | `workspaceMemberships.role = owner/admin`, in Workspace Settings |
| Target | Separate `apps/admin` app on `admin.getoverlay.io` | Stays in the web app, in Workspace Settings |

## Decisions

| Question | Decision (2026-10-14) |
| --- | --- |
| Domain | `admin.getoverlay.io` is enough. Use `__Host-` cookies and keep it outside the preview wildcard. |
| Staff sign-in | The owner is the only operator today. Use the **existing** WorkOS environment, with a new redirect URI for the admin host. Restrict access with an active `administrativePrincipals` row plus an `ADMIN_ALLOWED_USER_IDS` allowlist. A separate staff environment for admin is a tracked follow-up in `todos.md`. |
| IP allowlist | Optional. See "Checking IP allowlisting" in Stage 3. Without it, admin relies on WorkOS sign-in with MFA and the allowlist. |

## Why

1. **Smaller attack surface.** The web app every customer uses also serves `/api/v1/admin/*`, so a bug anywhere in the
   customer app sits one step away from operator powers.
2. **One shared secret controls everything.** Every `*ByServer` Convex function checks `INTERNAL_API_SECRET`, and the web
   app holds it. Whoever compromises the web server can call `convex/admin/administration.ts` and
   `convex/admin/authorization.ts` directly, without the UI. Moving the page doesn't fix this; splitting the secret does.
3. **Wrong place for the feature.** Operator data covers every tenant (the user directory returns every user; the audit log
   is global), but it is shown inside one workspace's sidebar.
4. **Many surfaces, one control plane.** Web, desktop, mobile and the extension share one Convex backend. One operator app
   is the natural place to see and act on users, workspaces, billing and usage across all of them.

## Initial state (before this migration, 2026-10-14)

- UI: `src/app/app/admin/page.tsx` with `src/features/admin/{authorization,catalog}`. It shows when
  `can('administration.access')` (`src/components/layout/sidebar/useAppSidebarState.ts:508`), and the route guard lives in
  `src/shared/authorization/client-policy.ts:33`.
- API: `src/app/api/v1/admin/{usage,audit,principals,catalog,authorization/*}`.
- Server: `src/server/admin/*` (`AdministrativeService`, `AuditService`, Convex repositories), wired in
  `src/server/bootstrap.ts`. `src/app/api/v1/api-keys/route.ts` also uses `administrativeService`.
- Convex: `convex/admin/administration.ts` (staff principals and the audit log) and `convex/admin/authorization.ts`
  (roles, groups, memberships, assignments, resource grants).
- Tables: `administrativePrincipals` (`admin`, `auditor`, `billing_admin`, `support`), `auditEvents`,
  `authorizationRoles`, `authorizationGroups`, `authorizationGroupMemberships`, `authorizationGroupRoles`,
  `authorizationUserRoles`, `authorizationResourceGrants`. **None of the authorization tables has a `workspaceId`.**
- The web app also **reads** the authorization tables on every request to decide everyday permissions
  (`conversations.create`, `models.use`, `files.upload`, and so on). It keeps read access and loses write access.
- Client: `packages/overlay-api-client` exposes `AdminAuthorizationClient` as `adminAuthorization`.
- Vercel: one project, `overlay-landing` (`prj_wucEZdZyA2xKUurHLXSuQNcS1YPy`, team `team_VT3uNspuyAOwicxedhtG4SMe`,
  Node 24.x, root directory = repo root). Root npm workspaces only include `packages/*`.

## Target architecture

```
                    customer surfaces                                 operator only
   ┌───────────┬──────────┬──────────┬──────────┐            ┌────────────────────────────┐
   │ web app   │ desktop  │ mobile   │ extension│            │ apps/admin                  │
   │ overlay-  │          │          │          │            │ Vercel: overlay-admin       │
   │ landing   │          │          │          │            │ admin.getoverlay.io         │
   └─────┬─────┴────┬─────┴────┬─────┴────┬─────┘            └──────────────┬─────────────┘
         │ INTERNAL_API_SECRET                                               │ ADMIN_API_SECRET
         │ (no admin writes, no admin reads)                 + operator's WorkOS token, checked again in Convex
         ▼                                                                   ▼
   ┌─────────────────────────────────────────────────────────────────────────────────────┐
   │ Convex (same deployments: per-PR preview / colorful-chickadee-419)         │
   │  admin functions        → ADMIN_API_SECRET + active administrativePrincipals row    │
   │  permission-check reads → still INTERNAL_API_SECRET (web app needs them)             │
   │  appendAuditByServer    → still INTERNAL_API_SECRET (append-only)                    │
   └─────────────────────────────────────────────────────────────────────────────────────┘
```

Key rules:

- The admin app talks to Convex directly from its own server code. It never goes through the web app's BFF.
- The web app never holds `ADMIN_API_SECRET`. The admin app never holds `INTERNAL_API_SECRET`, `SESSION_SECRET`, Stripe
  secret keys or provider keys.
- Admin uses its own cookie, `__Host-overlay_admin_session`, so the browser only sends it to `admin.getoverlay.io` itself.
  Sessions last 8 hours, with a 30-minute idle timeout. Destructive actions require a recent sign-in.

## Repo layout

```
apps/admin/                     new Next.js app (same Next version as the web app)
  src/app/...                   pages: overview, roles, groups, catalog (parity), later more
  src/server/                   admin-only server code (ported from src/server/admin)
  src/server/convex-admin.ts    the only module that talks to Convex
  next.config.ts, vercel.json, tsconfig.json, package.json
```

- Add `apps/*` to the root `workspaces`.
- Exclude `apps/**` in the root `tsconfig.json` and root ESLint config, so the web app's Vercel build doesn't typecheck
  the admin app. The admin app has its own `tsconfig.json`, `lint` and `typecheck` scripts.
- Use `@overlay/ui` for components and `@overlay/authz-contracts` for permission types. The logo is `OverlayMark`, per
  `AGENTS.md`.
- Boundary rules:
  - `src/**` may not import `apps/admin/**`.
  - `apps/admin/**` may not import `src/**`. Copy what it needs, or move shared pieces into `packages/`.
  - Only `apps/admin` may reference `ADMIN_API_SECRET`.

---

## Stage 1: Code (one Builder PR, parallel-safe)

**Goal:** a working `apps/admin` with the same features as today's `/app/admin`, built and tested locally. Nothing
deploys it.

**Why it is parallel-safe:** it adds a new directory and does not edit `src/**` or `convex/**`. The only shared files are
the root `package.json` (workspaces and scripts), `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`,
`scripts/ci/eslint-boundary-rules.mjs`, CI workflow files, `CHANGELOG.md` and docs. Rebase onto current main just before
marking the PR ready, then regenerate the lockfile from the merged `package.json`.

Branch: `codex/admin-console-app`.

Tasks:

- [x] Scaffold `apps/admin` as a Next.js app on the web app's Next version. Read `node_modules/next/dist/docs/` first.
- [x] Staff sign-in using the existing WorkOS environment (the callback path is `/auth/callback` on the admin host).
  - Cookie: `__Host-overlay_admin_session`, signed with `ADMIN_SESSION_SECRET`, 8-hour absolute and 30-minute idle
    lifetime.
  - Access requires all three: a valid WorkOS session, the user id listed in `ADMIN_ALLOWED_USER_IDS`, and an active
    `administrativePrincipals` row.
- [x] `src/server/convex-admin.ts`: the single module that calls Convex.
  - Calls the dedicated `admin/console:*` functions with `ADMIN_API_SECRET` and the authenticated operator token.
  - Customer-web credentials never substitute for this secret.
- [x] Port the four sections (Overview, Roles, Groups, Catalog) from `src/features/admin/*` and the API logic from
      `src/app/api/v1/admin/*` and `src/server/admin/*`. Copy them; don't move them. The web app copy stays until Stage 3.
- [x] Use the existing app chrome and design language: dark gray surfaces, Lucide icons, `OverlayMark` lockup.
- [x] Security headers in `apps/admin/next.config.ts`:
  - Strict CSP: `default-src 'self'`, plus Convex and WorkOS in `connect-src`, and `frame-ancestors 'none'`.
  - `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`.
- [x] `apps/admin/vercel.json` with `git.deploymentEnabled.main=true`; non-main builds are explicitly requested.
- [x] Root wiring: workspaces, `tsconfig`/ESLint exclusions, boundary rules, and root scripts `admin:dev`,
      `admin:build`, `admin:typecheck`, `admin:lint`, `admin:test`.
- [x] CI: one job (in an existing workflow, or a new `admin.yml`) that runs the admin typecheck, lint, test and build on
      PRs and in `merge_group`. Make it a required check once it is green.
- [x] Tests:
  - Sign-in gate: no session → redirect; non-allowlisted user → 403; principal revoked → 403.
  - The secret module is never imported into client code.
  - The ported service tests from `src/server/admin/AdministrativeService.test.ts`.
- [x] Docs:
  - Add `docs/develop/admin-console.md`: what the console is, local setup, env vars, the operator/workspace split.
  - Add it to the living-docs table in `AGENTS.md`.
  - Update `docs/develop/architecture.mdx` with the new `apps/` layer.
  - Add an Unreleased entry to `CHANGELOG.md`.

Builder QA for this stage (these scripts are planned and must be added during implementation):

- the planned `admin:typecheck`, `admin:lint`, `admin:test`, and `admin:build` scripts.
- Local smoke: the planned `admin:dev` script against the engineer-owned dev Convex backend.
  - Sign in.
  - Each of the four sections loads real dev data.
  - Change a role and see it reflected.
  - A non-allowlisted WorkOS user gets 403.
- The web app's normal PR Preview must still build and behave the same. The PR shouldn't change the web app, so check
  that `/app/admin` still works there.
- There is no hosted admin preview yet (the Vercel project is created in Stage 3), so say in the handoff that admin QA
  was local.

Acceptance criteria: an operator can sign in to the local admin app and do everything today's `/app/admin` does. The web
app build and behavior are unchanged.

## Stage 2: Convex (one Builder PR, after Stage 1 merges)

**Goal:** admin functions that the web app's secret can't call. The change is additive: the old functions stay, so
production web keeps working.

Branch: `codex/admin-convex-secret`.

Tasks:

- [x] `convex/lib/auth.ts`:
  - `requireAdminSecret()` checks `ADMIN_API_SECRET`, compared in constant time, failing closed when unset.
  - `requireOperator(ctx, roles)`:
    1. Checks the caller's WorkOS identity with Convex auth.
    2. Requires an active `administrativePrincipals` row with one of `roles`.
    3. Returns the actor id for audit records.
- [x] Add new admin functions, for example in `convex/admin/console.ts`, behind both checks. They cover:
  - Every **write** in `convex/admin/authorization.ts`.
  - Principal grant and revoke.
  - Audit list.
  - The user directory.

  Each write records its own `auditEvents` row in the same transaction.
- [x] Leave the reads the web app uses for permission checks, and `appendAuditByServer`, on `INTERNAL_API_SECRET`.
- [x] Switch `apps/admin/src/server/convex-admin.ts` to the new functions. Rename its env var to `ADMIN_API_SECRET` and
      forward the operator's access token for `requireOperator`.
- [x] Add a break-glass CLI path. It is an internal mutation, run with `npx convex run` by someone with deployment access,
      that grants the first `admin` principal and writes an audit event. Document it in `docs/develop/admin-console.md`.
- [x] Convex tests (`*.convex.test.ts`):
  - The internal secret is rejected by every new function.
  - The admin secret with no operator identity is rejected.
  - A revoked operator is rejected.
  - An `auditor` can list audit events but not write.
  - Each write produces an audit row.
- [x] Configure the isolated QA preview backend and matching admin branch settings with the dedicated preview secret. The [admin runbook](../../docs/develop/admin-console.md) documents provisioning; shared development backends are not migration test targets.
- [x] Docs: update `docs/develop/convex-workflow.mdx` and `docs/develop/admin-console.md`, and add a `CHANGELOG.md` entry.

Builder QA: Convex tests; the local admin app against the dev backend with the new functions; the web PR preview still
signs in, and permission checks still work there (create a chat, upload a file).

Release note: native Vercel Git deploys main. Convex synchronization is a separate operation from clean current canonical main, only after matching production web is live. Deploy the additive operator functions and restricted member initializer before contracting legacy endpoints.

## Stage 3: Deployment (owner-authorized; Integration thread)

The owner authorized Integration to complete this setup and release. Follow the applicable tool confirmation rules for consequential UI actions.

### 3a. Create the Vercel project `overlay-admin`

1. Create it in the Vercel dashboard (Add New → Project) or from `apps/admin`:

   ```bash
   vercel link --scope team_VT3uNspuyAOwicxedhtG4SMe --project overlay-admin
   ```

   Import the same GitHub repository as `overlay-landing`.
2. Build settings:
   - Framework: Next.js. Node: 24.x.
   - Root Directory: `apps/admin`.
   - Turn on "Include source files outside of the Root Directory", because the app needs `packages/*` and
     `convex/_generated`.
   - Leave the install command as the default. Vercel installs npm workspaces from the repo root.
3. Ignored Build Step: `scripts/vercel-ignore-build-admin.sh`, modeled on `scripts/vercel-ignore-build.sh`. It builds only
   when `apps/admin/**`, `packages/**`, `convex/admin/**`, `convex/lib/auth.ts`, `convex/schema.ts` or
   `package-lock.json` changed.
4. Deployment Protection:
   - Turn on Vercel Authentication for previews.
   - Disable the Vercel Toolbar and Comments.
   - Limit project access to the owner.
5. Environment variables. Nothing is shared with `overlay-landing`; generate fresh values.

   | Variable | Production | Preview |
   | --- | --- | --- |
   | `NEXT_PUBLIC_CONVEX_URL` | `colorful-chickadee-419` URL | that PR's preview Convex |
   | `ADMIN_API_SECRET` | new value (also set on Convex prod) | new value (also set on preview backends) |
   | `ADMIN_SESSION_SECRET` | new | new |
   | `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` | existing WorkOS environment | existing staging/test environment |
   | `ADMIN_ALLOWED_USER_IDS` | the owner's WorkOS user id | test operator id |

6. WorkOS: add `https://admin.getoverlay.io/auth/callback` and the preview callback pattern as redirect URIs. Confirm the
   owner account has MFA turned on. Verified Google 2-Step Verification enabled for `divyansh@layernorm.co` on 2026-10-14; WorkOS has no separate enrolled factor. This verifies enrollment, not enforcement across every AuthKit method.
7. Domain: add `admin.getoverlay.io` to `overlay-admin` and create a CNAME to Vercel. Confirm the web app's
   `*.preview.getoverlay.io` wildcard doesn't cover it.
8. Release: configure native Vercel Git deployments from main for the separate admin project, with the correct root/build settings. Then:
   - Deploy the exact main SHA.
   - Verify `admin.getoverlay.io` serves it.
   - Run an authenticated admin smoke test.

   Update `docs/develop/release-workflow.mdx` and `internal/develop/Development Workflow.md`.

### Checking IP allowlisting

Having a custom Vercel domain only shows that you can add custom domains. It doesn't tell you anything about IP
allowlisting. Two ways to check:

1. **Trusted IPs** (Deployment Protection): open Project → Settings → Deployment Protection. If the Trusted IPs section
   offers an upgrade instead of an input, the team plan doesn't include it. To check the plan, see Team Settings →
   Billing.
2. **Vercel Firewall custom rule**: open Project → Firewall → Configure → New Rule. Set the condition to "IP Address is
   not in [list]" and the action to Deny. If you can create this, it works as an allowlist. Scope it to the
   `admin.getoverlay.io` host.

With one operator on a changing home IP, an allowlist can lock you out. Add it only with a stable egress (a VPN or fixed
office IP), and keep the break-glass path in mind.

### 3b. First production release

1. Set `ADMIN_API_SECRET` on Convex production. The owner runs this command:

   ```bash
   # Explicit production-scoped deploy key; never source .env.local.
   npx convex env set ADMIN_API_SECRET ...
   ```

2. Deploy `overlay-admin` production from the exact main SHA.
3. Smoke test on `admin.getoverlay.io`:
   - Sign in.
   - All four sections load.
   - A role change appears in the audit log.
   - A non-allowlisted account is refused.

### 3c. Retire admin from the web app (Builder PR, merged only after 3b passes)

Branch: `codex/remove-web-admin`. A Builder can prepare this during Stage 1 or 2 and leave it as a draft until 3b passes.

- [x] Delete `src/app/app/admin`, `src/app/api/v1/admin/**`, `src/features/admin/**`, the Admin sidebar entry and the
      `client-policy.ts` `/app/admin` prefix. `/app/admin` returns 404 rather than redirecting.
- [x] Remove `AdminAuthorizationClient` from `@overlay/api-client`. First confirm desktop, mobile and the extension don't
      use it.
- [x] Move the permission check in `src/app/api/v1/api-keys/route.ts` off `administrativeService` and onto ordinary
      authorization checks. Remove the admin service from `src/server/bootstrap.ts` if nothing else uses it.
- [x] Add a CI check: the web build contains no `/api/v1/admin` routes, and `src/**` contains no `ADMIN_API_SECRET`.
- [x] Docs:
  - `docs/develop/api-route-catalog.mdx`, `compact-api-route-catalog.mdx`, `architecture.mdx`,
    `api-source-of-truth.mdx`.
  - The admin-related lines in `AGENTS.md`.
  - `CHANGELOG.md`.

### 3d. Retire the old Convex functions (Builder PR, after 3c is live)

- [x] Delete the old `INTERNAL_API_SECRET` admin write, list and directory functions in `convex/admin/*` and
      `auth/users:listUserDirectoryByServer`, if nothing else calls them. Keep the permission-check reads and
      `appendAuditByServer`. Ordinary role initialization uses `authorization/defaults:ensureDefaultUserRoleByServer`, which can only create the fixed member role and respects existing assignments.
- [x] Add a Convex test showing `INTERNAL_API_SECRET` can't reach any admin function.

Exit for the whole migration: the web app has no route, page or secret that can read or change operator data.

---

## Later (separate plans)

### Workspace-scoped access control

Add `workspaceId` to the authorization tables (roles, groups, memberships, assignments, resource grants), and backfill
today's rows as deployment defaults. Customer workspace admins then manage roles, groups and model/tool access in
Workspace Settings. The operator console manages only deployment defaults and system roles.

### Operator features beyond parity

Each item writes `auditEvents` and needs the matching operator role.

1. **Lookup** across surfaces: users and workspaces by email, id or slug; plan, credits, activity, devices and sessions
   (web, desktop, mobile, extension).
2. **Billing and usage**: plans, balances, holds, auto top-up, cost by model and surface; credit adjustments with a
   required reason. Read Stripe through a restricted read-only key.
3. **Support actions**: revoke sessions, suspend or reactivate, resend invites. Time-limited, reason-logged support access
   to a workspace.
4. **Fleet health**: active client versions per surface (check what clients report today first), plus failing
   automations, stuck agent runs and stale holds.
5. **Audit explorer**: filters and export.

### Self-hosting

Self-hosters run the same admin app with their own IT team as operators. Add an `admin` service to `docker/` and
`deploy/`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Parallel worktrees conflict with Stage 1 | Stage 1 adds a new directory and doesn't edit `src/**` or `convex/**`. Rebase and regenerate the lockfile last |
| The web app's build starts typechecking `apps/admin` | Root `tsconfig`/ESLint exclude `apps/**` (Stage 1) |
| Production has no console between stages | The web `/app/admin` is removed only after 3b passes |
| Convex functions removed while production web still calls them | 3d merges only after 3c is live |
| The web app loses permission checks by accident | Permission-check reads stay on `INTERNAL_API_SECRET`; Stage 2 QA checks everyday actions on the web preview |
| Operator lockout | Break-glass CLI grant (Stage 2), and no IP allowlist without a stable egress |

## Integration evidence

- #224/#225 merged at `7997a1a410e8ef7dbb5be9d66d74722acfd70526`; all nine required contexts passed on both reviewed heads. Admin tests: 25; additive backend tests: 8.
- `overlay-admin` project: `prj_IQJT4xvTp9F33h9UT51XJX1NIk5X`; `apps/admin`, Node 24, outside-root sources enabled, dedicated Production/Preview settings, verified `admin.getoverlay.io`.
- Real preview WorkOS sign-in/PKCE, persisted role edits, group membership, and non-allowlisted Google denial verified.
- Retirement preview #233: synthetic sign-in, session, notes and conversations return 200; `/app/admin` and removed API routes return 404. All 12 parity/separation/backend tests pass. Checkmarks above record implemented source; production retirement is not accepted until 3b and the web-first/backend-second rollout pass.

- Stage 3b accepted on production at `7997a1a41`: owner Google login, all four sections, zero-capability unassigned role create/edit/reload, audit readback and archive verified. A genuine synthetic production WorkOS identity in a signed test session was denied with 403 for GET and POST; anonymous API calls returned 401. This hosted session probe supplements the real non-allowlisted OAuth refusal on Preview.
