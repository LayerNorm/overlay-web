# Desktop release todo (post–P0 ops)

**Status:** open  
**Last updated:** 2026-07-25  
**Context:** Code-side P0 security work is largely done. Public history-free source lives at [LayerNorm/overlay-desktop](https://github.com/LayerNorm/overlay-desktop). Official macOS downloads remain frozen until Gate B.

This list is **owner/operator work**. Do not paste secrets into chat, issues, or commits. Put replacements only in production secret stores / protected GitHub environments.

---

## P0 — Owner actions before treating open source as “done”

### 0. Already completed (2026-07-25)

- [x] Draft `v0.1.19`–`v0.1.23` on `DevelopedByDev/overlay-releases` (assets retained; not deleted)
- [x] Keep `LayerNorm/overlay-desktop` as the canonical public history-free repo
- [x] Repository policy on `LayerNorm/overlay-desktop`:
  - no direct pushes to `main` (1 approving review + CODEOWNERS + required `verify` check)
  - protected release tags (`v*` ruleset)
  - protected `mac-release` / `release-publish` environments with required reviewers
  - signing/release secrets stored as **environment** secrets on `mac-release` (repo-level secrets empty)
  - org 2FA requirement enabled for LayerNorm

### 1. Rotate previously client-deliverable provider credentials

- [ ] **AI Gateway** — rotate/revoke keys that any desktop client could have received historically
- [ ] **OpenRouter** — rotate/revoke
- [ ] **Groq** — rotate/revoke
- [ ] **Composio** — rotate/revoke
- [ ] **NVIDIA** — rotate/revoke
- [ ] **Browser Use** — review and rotate if ever exposed or embedded
- [ ] **Daytona** — review and rotate if ever exposed or embedded
- [ ] Configure **hard spending caps** and **billing alerts** on each provider dashboard
- [ ] Prove old credentials fail (sample denied request) after rotation
- [ ] Install new secrets only in production stores (Vercel/Convex/server env, not local chat)

### 2. Session revocation window

**Scheduled:** Tuesday 2026-07-28, 09:00–09:30 America/Los_Angeles  
Users will need to sign in again.

- [ ] Communicate ahead of the window (in-app / email / Discord as applicable)
- [ ] Execute revocation (server/session invalidation path) during the window
- [ ] Spot-check: revoked refresh token cannot obtain a new access token
- [ ] Record completion time and any support impact

### 3. Hosted-operation kill-switch drill

**Scheduled:** Monday 2026-07-27, 10:00–10:15 America/Los_Angeles  
Deliberately blocks owner-funded hosted operations for ~15 minutes.

- [ ] Confirm no overlapping launch/demo during the window
- [ ] Set `OVERLAY_HOSTED_PROVIDER_KILL_SWITCH=1` in production
- [ ] Confirm owner-funded chat/agents fail closed with a clear error
- [ ] Unset the flag and confirm recovery
- [ ] Record duration and any customer impact

### 4. Org 2FA (LayerNorm)

- [x] Org-wide **Require two-factor authentication** is enabled for LayerNorm
- [ ] Confirm every org admin/maintainer still has 2FA enabled before Gate A sign-off

### 5. Signing / notarization secrets → protected environments on **LayerNorm/overlay-desktop**

Secrets already exist on **private** `DevelopedByDev/overlay-desktop` as **repository** secrets (updated ~2026-01–03).  
For open-source releases they must live on **public** `LayerNorm/overlay-desktop` as **environment** secrets only.

| Environment | Secrets | Notes |
| --- | --- | --- |
| `mac-release` | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`, `WORKOS_CLIENT_ID`, `DEV_WORKOS_CLIENT_ID`, optional `SENTRY_DSN` | Copy values from private repo secrets UI (GitHub never shows them again—re-enter from your password manager / Apple / p12 backup) |
| `release-publish` | none required for same-repo publish | Publish uses `GITHUB_TOKEN`. Legacy `GH_APP_ID` / `GH_APP_PRIVATE_KEY` + “Overlay Release Publisher” app are **optional/legacy** for `overlay-releases` only |

- [x] `mac-release` environment exists with required reviewer + protected-branch deploy policy
- [x] Apple/signing + WorkOS secrets present as **environment** secrets (not repo-level)
- [ ] Confirm values are current (rotate Apple app-specific password if unsure)
- [ ] Optional: delete or leave dormant `GH_APP_*` on the private repo; do not put the private key on the public repo
- [ ] After Gate B, remove Apple secrets from **repository-level** secrets on the private repo so there is one place of truth


### 6. Independent security + legal review (Gate A)

Gate A is still **PENDING** as a sign-off record even though the public repo exists.

- [ ] Independent Electron/agent (+ backend hostile-client) review
- [ ] Explicit accept/reject of time-bounded unsandboxed **Full access** exception
- [ ] Legal: AGPL/Apache package exceptions, notices, trademarks, fonts, icons, models, native helpers
- [ ] Fill and sign [GATE_A_SOURCE_PUBLICATION_CHECKLIST.md](./GATE_A_SOURCE_PUBLICATION_CHECKLIST.md)

### 7. Gate B / public DMG

Blocked until signing, notarization, and the protected release pipeline are real.

- [ ] Apple Developer account + Team ID confirmed
- [ ] Bundle ID ownership (`com.layernorm.overlay` or current ID) confirmed
- [ ] Developer ID Application certificate created/valid
- [ ] Notarization credentials working end-to-end
- [ ] Protected `release-macos` / `release-publish` environments reviewed
- [ ] Remove intentional `if: ${{ false }}` freeze only after Gate B sign-off
- [ ] Build from immutable 40-char SHA; verify nested signatures, fuses, SBOM, staple, Gatekeeper
- [ ] Clean Apple Silicon install/QA
- [ ] Fill and sign [GATE_B_BINARY_RELEASE_CHECKLIST.md](./GATE_B_BINARY_RELEASE_CHECKLIST.md)
- [ ] Only then re-enable website downloads (`OVERLAY_DESKTOP_DOWNLOADS_ENABLED=1`)

---

## Related docs

- [PUBLIC_REPOSITORY_EXPORT.md](../guides/PUBLIC_REPOSITORY_EXPORT.md)
- [RELEASE_PROCESS.md](../guides/RELEASE_PROCESS.md)
- [SECURITY_OPERATIONS.md](../guides/SECURITY_OPERATIONS.md)
- [INDEPENDENT_SECURITY_REVIEW.md](../guides/INDEPENDENT_SECURITY_REVIEW.md)

## Repo map (target / simplified)

| Repo | Role |
| --- | --- |
| **`LayerNorm/overlay-desktop`** | **Canonical** public source + signed GitHub Releases + CI (submodule target) |
| `DevelopedByDev/overlay-desktop` | Legacy private full-history clone — stop day-to-day development; archive when migrated |
| `DevelopedByDev/overlay-releases` | **Private / retired** — old drafted tags only; no new public DMGs |
| `LayerNorm/overlay-web` | Public web/server monorepo |

### Dual-repo streamlining (recommended)

**Make `LayerNorm/overlay-desktop` the only active desktop repo** and the monorepo submodule:

1. Point monorepo submodule URL at `https://github.com/LayerNorm/overlay-desktop.git`.
2. Develop only on LayerNorm (PRs + clean-clone CI).
3. Archive or freeze `DevelopedByDev/overlay-desktop` (read-only) so history stays private but unused.
4. Do **not** force-push private history into LayerNorm.

Keeping two active remotes is what caused the confusion. One public canonical repo is enough for open source.

---

## Decisions log

| Date | Decision | Owner |
| --- | --- | --- |
| 2026-07-24 | Drafted `v0.1.19`–`v0.1.23` on `overlay-releases` | ops |
| 2026-07-24 | Created public `LayerNorm/overlay-desktop` from history-free export | ops |
| 2026-07-24 | Privatized `DevelopedByDev/overlay-releases` | ops |
| 2026-07-24 | Point publish + updater + website at `LayerNorm/overlay-desktop` releases | ops |
| _unset_ | Session revocation window | _unset_ |
| _unset_ | Kill-switch drill window | _unset_ |
| _unset_ | Gate A signed | _unset_ |
| _unset_ | Gate B signed | _unset_ |
