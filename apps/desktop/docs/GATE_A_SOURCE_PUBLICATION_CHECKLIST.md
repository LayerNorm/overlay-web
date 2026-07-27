# Gate A — source publication

**Gate status:** PENDING (evidence partially filled; signatures still required)

**Candidate source commit:** `f6895c2e4651260b97ded711db1ed9a6cb51ee9d`
(`LayerNorm/overlay-desktop` `main` tip as of 2026-07-25 after [#22](https://github.com/LayerNorm/overlay-desktop/pull/22))

**History-free public root commit:** `7abc946e5c8264856a7d74fe54fb21831b012072`
(`Initial public release of Overlay Desktop.`)

**Decision date:** _unset_ — set when all five signatures are APPROVED

This file is a sign-off record template. Its presence is not approval.
Filled commit identifiers below do **not** authorize public binary release
(Gate B) or enable website downloads.

## Required approvals

- [ ] Security owner confirms every Critical is fixed and every High is fixed or
      accepted under the documented exception policy.
- [ ] Independent reviewer signs the source/backend scope and the desktop-chat
      unsandboxed Full access exception
      (see [INDEPENDENT_SECURITY_REVIEW.md](../guides/INDEPENDENT_SECURITY_REVIEW.md);
      Full access exception renew/expiry target: 2027-01-24).
- [ ] Legal owner approves AGPL/Apache licensing, notices, trademark policy,
      contributor terms, and every distributed asset/model/native component.
- [ ] Repository administrator verifies branch protection, required checks and
      reviews, CODEOWNERS, maintainer 2FA, secret scanning, push protection,
      Dependabot, private vulnerability reporting, and protected environments.
      *(API-verified controls listed under evidence; personal 2FA enrollment for
      every admin/maintainer still needs owner confirmation.)*
- [ ] Operations owner verifies provider hard caps, paid-operation kill switch,
      auth abuse monitoring, reservation reconciliation, and incident contacts.
      *(Kill-switch drill done; hard caps, key rotation, session revocation,
      and monitoring contacts still open.)*

## Required evidence

- [x] History-free public root is `7abc946e5c8264856a7d74fe54fb21831b012072` on
      `LayerNorm/overlay-desktop`; private full history remains only on archived
      `DevelopedByDev/overlay-desktop` (do not unarchive/publicize).
- [x] Clean public checkout / CI: `verify` (Clean public clone) green on recent
      merges including [#19](https://github.com/LayerNorm/overlay-desktop/pull/19)
      and [#21](https://github.com/LayerNorm/overlay-desktop/pull/21); signed
      dry-run `build-mac` green for SHA
      `105cdae441582e5d50f4bf8ce3ca6b6dad9508f9`
      ([run 30155922115](https://github.com/LayerNorm/overlay-desktop/actions/runs/30155922115)).
- [ ] Approved scanners found no secret, private data, internal report, or
      private dependency in the exported tree or private history
      *(secret scanning + push protection enabled; full private-history scan
      sign-off still required from security owner).*
- [ ] Canonical server hostile-client tests passed for every enabled provider
      and supported Convex/Postgres configuration.
      *(A fail-closed matrix runner, unit tests, example configuration, and
      private-evidence procedure now exist in `LayerNorm/overlay-web`;
      dedicated-deployment provider execution and independent review remain
      open.)*
- [ ] Private vulnerability intake was tested end to end
      *(Private Vulnerability Reporting is **enabled** on
      `LayerNorm/overlay-desktop` and `LayerNorm/overlay-web`; synthetic intake
      test not yet recorded).*

### Repository controls (API-verified 2026-07-25)

| Control | Status |
| --- | --- |
| Org-wide 2FA required (`LayerNorm`) | Enabled |
| Private vulnerability reporting (desktop + web) | Enabled |
| Secret scanning | Enabled |
| Secret scanning push protection | Enabled |
| Dependabot security updates | Enabled |
| Protected `mac-release` / `release-publish` envs | Present (prior ops) |
| CODEOWNERS + required `verify` | Present (prior ops) |
| Every admin/maintainer personally has 2FA | **Owner confirm** |
| Apple / CSC secrets current in `mac-release` | Owner confirmed 2026-07-25 |

### Native dependency remediation (agent-verified 2026-07-26)

The distributed Parakeet helper was rebuilt on Apple Silicon after updating the
three Swift packages covered by the open runtime advisories:

| Package | Previous | Rebuilt version |
| --- | ---: | ---: |
| `swift-nio` | 2.90.1 | 2.101.3 |
| `swift-nio-extras` | 1.31.0 | 1.34.3 |
| `swift-nio-http2` | 1.39.0 | 1.45.0 |

The rebuilt arm64 Mach-O is pinned in `native-artifacts.json` as
`0243a849fe2db64fd288a446534227c690c29f9b699de29261b0964bb09ec6ac`;
the corresponding reviewed source-tree digest is
`ba51414fcbd4635e2534a0400b2f4cc59c1b3caaae609d41d870b57699f953e7`.
`npm run check:native-artifacts` passes and confirms that no private workstation
path is embedded. Signed packaging verification must still be repeated during
Gate B for the final immutable candidate.

### Ops — kill-switch drill (2026-07-25, Vercel production `overlay-landing`)

Recorded by agent; does **not** complete Ops signature alone.

| Step | Result |
| --- | --- |
| Baseline `GET https://www.getoverlay.io/api/v1/discovery` | `hostedInference: true` |
| Set `OVERLAY_HOSTED_PROVIDER_KILL_SWITCH=1` (Production) | Env added |
| Redeploy production | [dpl_HhkteWrm…](https://vercel.com/divyansh-lalwanis-projects/overlay-landing/HhkteWrmdqpjs4ffF1SWyLvLhiEe) → aliased to www |
| Discovery with kill switch on | `hostedInference: false` |
| Remove kill-switch env var | Removed from Production |
| Redeploy production | [dpl_6H7DBZoU…](https://vercel.com/divyansh-lalwanis-projects/overlay-landing/6H7DBZoU2G91zG4QkjAoWF6JVQWf) → aliased to www |
| Discovery after recovery | `hostedInference: true` |
| Smoke after recovery | `/` `200`, `/download` `200`, `/api/v1/discovery` `200` |
| Provider key **names** present in Vercel Production | `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `COMPOSIO_API_KEY`, `NVIDIA_API_KEY`, `BROWSER_USE_API_KEY`, `DAYTONA_API_KEY` (+ session/WorkOS/Stripe/R2) |
| Key **rotation** + provider hard caps | **Still open** (owner) |
| Session revocation drill | Scheduled Tue 2026-07-28 09:00–09:30 PT |

## Signatures

| Role | Name | Evidence link | Date | Decision |
| --- | --- | --- | --- | --- |
| Security owner | _unset_ | _unset_ | _unset_ | PENDING |
| Independent reviewer | _unset_ | _unset_ | _unset_ | PENDING |
| Legal/asset owner | _unset_ | _unset_ | _unset_ | PENDING |
| Repository administrator | _unset_ | Partial: controls table above | 2026-07-25 | PENDING |
| Operations owner | _unset_ | Partial: kill-switch drill above | 2026-07-25 | PENDING |
