# Desktop release todo

**Status:** open  
**Last updated:** 2026-07-25  
**Context:** Public history-free source is live at [LayerNorm/overlay-desktop](https://github.com/LayerNorm/overlay-desktop) (`main` tip after Dependabot batch). Official macOS downloads remain frozen until Gate B. Do not paste secrets into chat, issues, or commits.

Ownership legend:

- **You (owner)** — credentials, Apple account, production drills, legal, external review, final Gate A/B signatures
- **Agent** — docs, Mintlify, website download UX, CI/release plumbing that does not require private keys
- **Shared** — agent prepares; you approve / run in production / sign

---

## P0 — Remaining before treating open source / Gate A as done

### 0. Already completed (2026-07-25)

- [x] Draft `v0.1.19`–`v0.1.23` on `DevelopedByDev/overlay-releases`
- [x] Create/keep `LayerNorm/overlay-desktop` as canonical history-free public repo
- [x] Repository policy (PR reviews, CODEOWNERS, required `verify`, protected `v*` tags, `mac-release` / `release-publish`, env secrets, org 2FA)
- [x] Point mono + `overlay-landing` submodule remotes at LayerNorm
- [x] Archive private `DevelopedByDev/overlay-desktop` (still private)
- [x] Merge host-exec hardening + Dependabot batch on LayerNorm `main`
- [x] Website downloads fail closed until Gate B (`OVERLAY_DESKTOP_DOWNLOADS_ENABLED`)

### 1. Rotate provider credentials — **You**

- [ ] AI Gateway — rotate/revoke historically deliverable keys
- [ ] OpenRouter — rotate/revoke
- [ ] Groq — rotate/revoke
- [ ] Composio — rotate/revoke
- [ ] NVIDIA — rotate/revoke
- [ ] Browser Use — review/rotate if ever exposed
- [ ] Daytona — review/rotate if ever exposed
- [ ] Hard spending caps + billing alerts on each provider
- [ ] Prove old credentials fail
- [ ] Install replacements only in production secret stores

### 2. Session revocation — **You** (agent can help prepare scripts/checklist)

**Scheduled:** Tuesday 2026-07-28, 09:00–09:30 America/Los_Angeles

- [ ] Communicate ahead of the window
- [ ] Execute revocation
- [ ] Spot-check revoked refresh tokens
- [ ] Record completion / impact

### 3. Kill-switch drill — **You** (agent can help verify fail-closed UX)

**Executed early (Vercel half):** Saturday 2026-07-25 (~14:00–14:06 America/Los_Angeles)
on production `overlay-landing` / `www.getoverlay.io`. Evidence in
[GATE_A_SOURCE_PUBLICATION_CHECKLIST.md](./GATE_A_SOURCE_PUBLICATION_CHECKLIST.md).

- [x] Confirm no overlapping launch/demo (ad-hoc window; owner-approved)
- [x] Set `OVERLAY_HOSTED_PROVIDER_KILL_SWITCH=1` in production
- [x] Confirm discovery fail-closed (`hostedInference: false`)
- [x] Unset flag and confirm recovery (`hostedInference: true`)
- [x] Record duration / impact (~6 minutes aliased prod; see Gate A checklist)
- [ ] Optional: re-run in the original Mon 2026-07-27 window if you want a
      calendar-aligned drill with broader owner-funded chat smoke

### 4. Org / maintainer hygiene — **You**

- [x] LayerNorm org 2FA required
- [ ] Confirm every admin/maintainer has 2FA before Gate A sign-off
- [x] Confirm `mac-release` Apple/signing secrets are still current (owner 2026-07-25)

### 5. Gate A sign-off — **You** (external reviewers); agent can package evidence

Gate A checklist is still **PENDING** (commit fields + partial evidence filled;
all five signatures blank).

- [ ] Independent Electron/agent (+ backend hostile-client) review
- [x] Add fail-closed hostile-client matrix runner, unit tests, example config,
      and private evidence procedure to `LayerNorm/overlay-web`
- [ ] Execute that matrix on dedicated Convex/Postgres deployments for every
      enabled provider and reconcile provider calls against Overlay accounting
- [ ] Explicit accept/reject of unsandboxed **Full access** exception
- [ ] Legal: AGPL/Apache, notices, trademarks, fonts, icons, models, native helpers
- [x] Fill [GATE_A_SOURCE_PUBLICATION_CHECKLIST.md](./GATE_A_SOURCE_PUBLICATION_CHECKLIST.md) commit fields + recorded evidence
- [ ] Sign Gate A checklist (five roles)
- [ ] Keep detailed security reports private (do not publish remediation reports)

### Dependency follow-ups

- [x] Rebuild Parakeet after patched Swift NIO bumps and update
      `native-artifacts.json` (**Agent**, completed 2026-07-26)
- [ ] Later majors: `ai@7` + `@openrouter/ai-sdk-provider@3`; Vite 8 + `@vitejs/plugin-react@6` (**Agent** when scheduled)

---

## P1 — README and repository documents — **Agent** (except assets you supply)

Before public launch polish (can start before Gate B; live DMG CTA waits for Gate B):

- [x] Update [README.md](../README.md) with canonical repo + website URLs
- [x] Fix `getoverlay.app` vs `getoverlay.io` inconsistency (README / SUPPORT)
- [x] Add “Download for macOS” section (points to getoverlay.io; fail-closed until Gate B)
- [x] Label Apple Silicon / macOS-only support
- [x] Label initial release beta if appropriate
- [x] Explain hosted cloud features require Overlay Server
- [x] Local vs cloud features compact table
- [x] Document `APP_SERVER_URL` and self-hosted server compatibility
- [ ] Add screenshots or short product demo (**You** supply media if needed; **Agent** wires them)
- [x] Document macOS permissions (microphone, Accessibility, Apple Events, files, browser, Keychain)
- [x] Explain Ask for approval vs Full access prominently
- [x] Troubleshooting: auth, Keychain, permissions, native models
- [x] Uninstall + local-data removal instructions
- [x] Add `CHANGELOG.md`
- [x] Add `SUPPORT.md` (supported / unsupported configs)
- [x] Verify links in README, SECURITY, CONTRIBUTING, privacy, release docs
- [x] Retain SECURITY.md, CONTRIBUTING.md, SECURITY_ARCHITECTURE.md, THREAT_MODEL.md; keep detailed reports private

---

## P1 — Mintlify documentation — **Agent**

Rename site description from “Overlay Web” to “Overlay”. Add top-level **Desktop** group
(lives in `LayerNorm/overlay-web` `docs/`):

- [x] Desktop overview and architecture
- [x] Download and installation
- [x] System requirements and supported Macs
- [x] Sign-in and hosted Overlay Server behavior
- [x] Connecting to a self-hosted Overlay Server
- [x] Building from source
- [x] Local versus cloud data flows
- [x] Chat operation permissions
- [x] macOS permissions and why they are requested
- [x] Browser-agent security model
- [x] Local and cloud transcription
- [x] Updating and release channels
- [x] Uninstalling and deleting local data
- [x] Privacy and diagnostics
- [x] Security reporting
- [x] Troubleshooting
- [x] Release verification (signature, notarization, checksum, provenance)
- [x] Desktop changelog / release notes

---

## P1 — Official macOS build and download (Gate B) — **Shared**

After Gate A. Credentials/Apple account = **You**. Pipeline/docs/QA scripts = **Agent**.

**Agent prepared (do not use until Apple creds confirmed):**
[GATE_B_CLEAN_MAC_QA.md](./qa/GATE_B_CLEAN_MAC_QA.md),
[RELEASE_FREEZE_REMOVAL.md](./qa/RELEASE_FREEZE_REMOVAL.md).
Publish freeze (`if: ${{ false }}`) remains until you confirm Apple credentials.

- [ ] Confirm Apple Developer account and Team ID — **You**
- [ ] Confirm ownership of `com.layernorm.overlay` — **You**
- [ ] Create/validate Developer ID Application certificate — **You**
- [ ] Configure notarization credentials — **You**
- [ ] Confirm protected `mac-release` / `release-publish` environments — **Shared** (mostly done)
- [ ] Store signing/notarization credentials only in protected build env — **You**
- [ ] Least-privilege GitHub App for `overlay-releases` if still needed — **You** / optional
- [ ] Remove intentional `if: ${{ false }}` release freeze only after review — **Shared** (see freeze-removal doc)
- [ ] Build from immutable 40-char SHA — **Agent** (CI) / **You** approve
- [ ] Verify nested signatures, hardened runtime, entitlements, fuses, ASAR, SBOM, native-helper hashes — **Shared**
- [ ] Notarize and staple DMG + ZIP — **CI with your creds**
- [ ] Gatekeeper accept on clean Apple Silicon Mac — **You** or **Agent** with access to a clean Mac
- [ ] Publish DMG, ZIP, updater metadata, SBOM, checksums, manifest, provenance — **CI**
- [ ] Test install without developer certs / local env files — **Shared** (use clean-Mac QA)
- [ ] First-run auth; dialogs say “Overlay” not “Electron” — **Shared**
- [ ] Test update / interrupted update / replay / downgrade rejection / rollback / compromised metadata — **Shared**
- [ ] Test uninstall + retained local-data behavior — **Shared**
- [ ] Fill and sign [GATE_B_BINARY_RELEASE_CHECKLIST.md](./GATE_B_BINARY_RELEASE_CHECKLIST.md) — **You**

---

## P1 — Website download experience — **Agent** (enable flag = **You** after Gate B)

- [x] Dedicated `/download` page
- [x] “Download for macOS” on homepage + account page
- [x] Route through `/api/latest-release/download`
- [x] Show current version + release date (when downloads enabled + release exists)
- [x] State “macOS, Apple Silicon” before download
- [x] Link release notes, checksum, privacy, source repo, system requirements
- [x] Useful fallback when GitHub unavailable / no DMG
- [x] Do not advertise a release before Gate B passes (fail-closed copy + API 503)
- [ ] Test Safari, Chrome, signed-out, mobile — **Shared** (after deploy)
- [ ] Confirm auto-update metadata and website resolve to same version — after Gate B
- [ ] After Gate B: set `OVERLAY_DESKTOP_DOWNLOADS_ENABLED=1` in production — **You**

---

## Related docs

- [GATE_A_SOURCE_PUBLICATION_CHECKLIST.md](./GATE_A_SOURCE_PUBLICATION_CHECKLIST.md)
- [GATE_B_BINARY_RELEASE_CHECKLIST.md](./GATE_B_BINARY_RELEASE_CHECKLIST.md)
- [PUBLIC_REPOSITORY_EXPORT.md](../guides/PUBLIC_REPOSITORY_EXPORT.md)
- [RELEASE_PROCESS.md](../guides/RELEASE_PROCESS.md)
- [SECURITY_OPERATIONS.md](../guides/SECURITY_OPERATIONS.md)
- [INDEPENDENT_SECURITY_REVIEW.md](../guides/INDEPENDENT_SECURITY_REVIEW.md)

## Repo map

| Repo | Role |
| --- | --- |
| **`LayerNorm/overlay-desktop`** | Canonical public desktop source + future signed releases |
| `DevelopedByDev/overlay-desktop` | Archived private full-history (do not unarchive/publicize) |
| `DevelopedByDev/overlay-releases` | Private; old drafted tags only |
| `LayerNorm/overlay-web` | Public web/server |

---

## Decisions log

| Date | Decision | Owner |
| --- | --- | --- |
| 2026-07-24 | Drafted `v0.1.19`–`v0.1.23` on `overlay-releases` | ops |
| 2026-07-24 | Created public `LayerNorm/overlay-desktop` from history-free export | ops |
| 2026-07-25 | Canonical submodule + remotes → LayerNorm; private desktop archived | ops |
| 2026-07-25 | Kill-switch drill scheduled Mon 2026-07-27 10:00–10:15 PT | owner |
| 2026-07-25 | Vercel kill-switch drill executed early on www.getoverlay.io | agent |
| 2026-07-25 | Session revocation scheduled Tue 2026-07-28 09:00–09:30 PT | owner |
| 2026-07-25 | P1 docs/Mintlify/download UX landed; publish freeze kept | agent |
| 2026-07-25 | Gate A checklist candidate SHA + history-free root filled | agent |
| _unset_ | Gate A signed | _unset_ |
| _unset_ | Gate B signed | _unset_ |
| _unset_ | Apple signing/notarization creds confirmed → unfreeze publish | _unset_ |
