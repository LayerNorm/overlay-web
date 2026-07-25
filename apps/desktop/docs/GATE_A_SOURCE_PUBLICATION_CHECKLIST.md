# Gate A — source publication

**Gate status:** PENDING (fields filled; signatures still required)

**Candidate source commit:** `a544070e0c265c0642747ceb05baf6d0247f21dd`
(`LayerNorm/overlay-desktop` `main` tip as of 2026-07-25; includes P1 docs #19)

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
      unsandboxed Full access exception.
- [ ] Legal owner approves AGPL/Apache licensing, notices, trademark policy,
      contributor terms, and every distributed asset/model/native component.
- [ ] Repository administrator verifies branch protection, required checks and
      reviews, CODEOWNERS, maintainer 2FA, secret scanning, push protection,
      Dependabot, private vulnerability reporting, and protected environments.
- [ ] Operations owner verifies provider hard caps, paid-operation kill switch,
      auth abuse monitoring, reservation reconciliation, and incident contacts.

## Required evidence

- [ ] `npm run public:export` created the candidate from the approved private
      source commit, and the public remote contains no private history.
- [ ] Clean exported checkout passed `npm ci`, standalone/license/security
      checks, tests, build, and unsigned arm64 packaging.
- [ ] Approved scanners found no secret, private data, internal report, or
      private dependency in the exported tree or private history.
- [ ] Canonical server hostile-client tests passed for every enabled provider
      and supported Convex/Postgres configuration.
- [ ] Private vulnerability intake was tested end to end.

### Partial ops evidence (2026-07-25, Vercel production `overlay-landing`)

Recorded by agent; does **not** complete Ops signature (hard caps, session
revocation, monitoring contacts, and key rotation remain owner actions).

| Step | Result |
| --- | --- |
| Baseline `GET https://www.getoverlay.io/api/v1/discovery` | `hostedInference: true` |
| Set `OVERLAY_HOSTED_PROVIDER_KILL_SWITCH=1` (Production) | Env added |
| Redeploy production | [dpl_HhkteWrm…](https://vercel.com/divyansh-lalwanis-projects/overlay-landing/HhkteWrmdqpjs4ffF1SWyLvLhiEe) → aliased to www |
| Discovery with kill switch on | `hostedInference: false` |
| Remove kill-switch env var | Removed from Production |
| Redeploy production | [dpl_6H7DBZoU…](https://vercel.com/divyansh-lalwanis-projects/overlay-landing/6H7DBZoU2G91zG4QkjAoWF6JVQWf) → aliased to www |
| Discovery after recovery | `hostedInference: true` |
| Provider key **names** present in Vercel Production | `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `COMPOSIO_API_KEY`, `NVIDIA_API_KEY`, `BROWSER_USE_API_KEY`, `DAYTONA_API_KEY` (+ session/WorkOS/Stripe/R2) |
| Key **rotation** | Not performed in this drill (values still owner-managed; ages ~93–96d at drill time) |

## Signatures

| Role | Name | Evidence link | Date | Decision |
| --- | --- | --- | --- | --- |
| Security owner | _unset_ | _unset_ | _unset_ | PENDING |
| Independent reviewer | _unset_ | _unset_ | _unset_ | PENDING |
| Legal/asset owner | _unset_ | _unset_ | _unset_ | PENDING |
| Repository administrator | _unset_ | _unset_ | _unset_ | PENDING |
| Operations owner | _unset_ | Partial: kill-switch drill above | 2026-07-25 | PENDING |
