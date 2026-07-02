# Overlay Docs

Keep docs short and current. Prefer updating these files over adding new one-off reports.

## Structure

`docs/` is both the **source of truth** for prose content and the **Mintlify site root**. The directory contains:

- `*.md` — canonical source files (edit these)
- `*.mdx` — Mintlify pages (some are synced from .md files, some are hand-written)
- `docs.json` — Mintlify navigation and theme config
- `openapi/` — generated API reference (`npm run docs:generate:api`)
- `config/` — validated self-hosting config examples
- `start/`, `configure/`, `develop/`, `deploy-operate/`, `legal/`, `api-reference/` — Mintlify page directories
- `snippets/` — reusable MDX fragments imported by hand-written pages
- `reports/`, `design-assets/` — internal artifacts (not part of the public docs site)

## Synced pages

A sync script (`npm run docs:sync`) converts `docs/*.md` source files into `docs/**/*.mdx` Mintlify pages with frontmatter and link rewriting. Synced MDX files have a DO-NOT-EDIT header.

**To update a synced page:** edit the `.md` source, then run `npm run docs:sync` (or `npm run docs:dev` / `npm run docs:check` which run sync automatically).

| Source (.md) | Synced page (.mdx) |
| --- | --- |
| `architecture.md` | `develop/architecture.mdx` |
| `SELF_HOSTING.md` | `deploy-operate/self-hosting.mdx` |
| `security.md` | `deploy-operate/security.mdx` |
| `PHASE6_RELEASE_GATES.md` | `deploy-operate/release-gates.mdx` |
| `LICENSING.md` | `legal/licensing.mdx` |
| `LEGAL_SELF_HOSTING_NOTES.md` | `legal/self-hosting-obligations.mdx` |
| `TENANCY.md` | `deploy-operate/tenancy.mdx` |
| `customization.md` | `develop/customization.mdx` |
| `feature-modules.md` | `develop/feature-modules.mdx` |
| `api-source-of-truth.md` | `develop/api-source-of-truth.mdx` |

Hand-written MDX pages (not synced — edit the .mdx directly): `introduction.mdx`, `start/*`, `configure/*`, `develop/convex-workflow.mdx`, `develop/local-integrations.mdx`, `api-reference/*`, `legal/security-reporting.mdx`.

## Living Docs

- [Architecture](./architecture.md) - backend boundaries, auth, billing, storage, and client parity.
- [Development](./development.md) - local setup, required env vars, scripts, and verification.
- [Self Hosting](./SELF_HOSTING.md) - runtime config, provider swaps, deployment profiles, and secret placement.
- [Phase 6 Release Gates](./PHASE6_RELEASE_GATES.md) - programmatic gate and manual UI QA for on-prem releases.
- [Tenancy](./TENANCY.md) - single-customer deployment boundary, role model, and Phase 6b shared-tenant checklist.
- [Licensing](./LICENSING.md) - AGPL core, Apache ecosystem packages, commercial license path, and trademark boundaries.
- [Legal Self Hosting Notes](./LEGAL_SELF_HOSTING_NOTES.md) - release checklist for enterprise distributions.
- [Design](./design.md) - durable product and UI principles.
- [Security](./security.md) - release gates and security-sensitive workflow notes.

Root-level docs:

- [`../README.md`](../README.md) - product overview and quick start.
- [`../SECURITY.md`](../SECURITY.md) - vulnerability reporting policy.
- [`../LICENSE.md`](../LICENSE.md) - license terms.
- [`../TRADEMARKS.md`](../TRADEMARKS.md) - brand and naming policy.
- [`../NOTICE.md`](../NOTICE.md) - release notices.
