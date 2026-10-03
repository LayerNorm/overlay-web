# Codex subscription, experimental agents, and E2B

Phase 6 of `docs/plans/OVERLAY_CLOUD_AGENTS_PLAN.md`. Three independent parts.

## A. Codex on a ChatGPT subscription (credential broker)

**Problem.** Codex signs in with ChatGPT and keeps `auth.json` with a refresh token that *rotates*: each refresh invalidates the previous one. Two machines holding the same token would break each other. So no machine holds the real refresh token — Overlay does.

**Sign-in.** Device-code flow against `https://auth.openai.com` (client id `app_EMoamEEZ73f0CkXaXp7hrann`). `POST /api/v1/provider-accounts/codex-sign-in` with `action: start` returns a code and `https://auth.openai.com/codex/device`; the person approves there; `action: poll` returns `pending` until approved, then exchanges the code and stores the token set. The Agent accounts dialog does this; pasting a Codex subscription secret is refused (`use_sign_in`).

**Storage.** One vault secret per account (JSON `CodexTokenSet`). Convex holds metadata and the opaque reference only.

**Refresh.** `AgentProviderAccountService.freshCodexTokens` refreshes server-side when the access token expires within 25 minutes. A Convex lease (`refreshLockOwner` / `refreshLockUntil` on `agentProviderAccounts`, `acquireRefreshLockByServer` / `releaseRefreshLockByServer`) lets exactly one run refresh at a time; others wait up to 20 s then reread. New tokens are stored *before* the lock is released. A rejected refresh (`invalid_grant`, 400/401) flags the account `needs_reauth`; a transient failure does not.

**Delivery.** On `issueRunCredentials` the app server writes a per-run `/home/user/.codex/auth.json` to the machine through `deliverMachineFiles` (`CloudAgentMachineService.writeFiles`; paths must be under `/home/user/`). It holds a fresh access token and a **placeholder** refresh token, so a machine can never rotate the real one. Codex only refreshes after 8 days or on a 401; a placeholder refresh therefore fails harmlessly and the next run gets a new file. The host protocol is unchanged.

**Known limit.** `auth.json` (with a short-lived access token) stays on the machine's disk after a run, until the next run overwrites it.

**Verification status.** Unit and Convex tests cover the flow, the lock, and delivery. Live verification (a real ChatGPT approval, and two Codex agents on one account) needs the account owner to approve a device code; record the result here when done.

## B. Experimental bring-your-own-key agents

OpenCode and Hermes run on an OpenRouter key (`OPENROUTER_API_KEY`); Cursor on `CURSOR_API_KEY`. They are marked `experimental` in `src/shared/agents/provider-accounts.ts`. The host maps them through acpx (`ACPX_SYSTEM_AGENT_NAMES`, `ACPX_AGENT_LAUNCH_OVERRIDES` — Hermes needs a launch override — in `packages/overlay-agent-host/src/acpx-adapter.ts`). The machine image already contains these CLIs. Host and protocol packages are 0.3.8; the machine runs the host through a pinned `npx` spec, so the image stays `overlay-agent-v2`.

## C. E2B adapter (self-hosting)

`packages/overlay-sandbox-runtime/src/e2b.ts` implements the sandbox runtime on E2B. Set:

```
OVERLAY_MANAGED_SANDBOX_PROVIDER=e2b
E2B_API_KEY=...
OVERLAY_CLOUD_AGENT_IMAGE=overlay-agent:v2     # printed by the build script
npx tsx infra/agent-image/build-e2b.mts        # builds the template
```

Sandboxes use `onTimeout: 'pause'`, `autoResume: false`; Overlay's own idle meter stops them. Billing uses the E2B rate card in `ManagedAgentSandboxBilling.ts`. Tested against a fake SDK only; not run against real E2B.
