# Codex subscription and E2B

Credential brokerage, retired provider records, and the E2B self-hosting
adapter are three independent parts of the connected-agent system.

## A. Codex on a ChatGPT subscription (credential broker)

**Problem.** Codex signs in with ChatGPT and keeps `auth.json` with a refresh token that *rotates*: each refresh invalidates the previous one. Two machines holding the same token would break each other. So no machine holds the real refresh token — Overlay does.

**Sign-in.** Device-code flow against `https://auth.openai.com` (client id `app_EMoamEEZ73f0CkXaXp7hrann`). `POST /api/v1/provider-accounts/codex-sign-in` with `action: start` returns a code and `https://auth.openai.com/codex/device`; the person approves there; `action: poll` returns `pending` until approved, then exchanges the code and stores the token set. The Agent accounts dialog does this; pasting a Codex subscription secret is refused (`use_sign_in`).

**Storage.** One vault secret per account (JSON `CodexTokenSet`). Convex holds metadata and the opaque reference only.

**Refresh.** `AgentProviderAccountService.freshCodexTokens` refreshes server-side when the access token expires within 25 minutes. A Convex lease (`refreshLockOwner` / `refreshLockUntil` on `agentProviderAccounts`, `acquireRefreshLockByServer` / `releaseRefreshLockByServer`) lets exactly one run refresh at a time; others wait up to 20 s then reread. New tokens are stored *before* the lock is released. A rejected refresh (`invalid_grant`, 400/401) flags the account `needs_reauth`; a transient failure does not.

**Delivery.** Hosted Cloud run-credential delivery is retired and the compatibility endpoint returns 410. Provider-account records and token refresh remain available to supported model/subscription adapters; they are not issued to hosted third-party harnesses.

**Host credential delivery.** No provider-account credentials are delivered to retired hosted
third-party runtimes. A BYOM harness keeps and refreshes its own subscription session on the
user-owned host; model/subscription adapters use provider-account records independently.

The former managed-host Preview bootstrap credential is retired. BYOM hosts use their own enrollment
credential and the standard signed control-plane protocol.

**Verification status.** Unit and Convex tests cover the broker and refresh lock. Live verification (a real ChatGPT approval) needs the account owner to approve a device code; record the result here when done.

## Model choice

A connected agent stores its model as `byo/<adapter>#<model>`; no suffix selects the agent's default. The bound environment's advertised catalog supplies the model, permission and effort controls. Static legacy choices are only a fallback before discovery; an agent that reports no catalog must not inherit an invented list.

Modern Codex catalogs can report a base model and a separate effort selector. Older saved choices such as `gpt-6-sol[high]` remain valid: preserve an exact advertised id first, otherwise resolve its base and effort only when both are offered. The UI displays that effective pair and preserves effort on model changes; an explicit saved effort overrides the older suffix. Missing models or effort levels stay visibly unsupported. The host applies choices through ACP configuration and rejects vendor errors rather than silently using another setting.

Model, effort, permissions and Overlay access save independently for the next turn; the identity editor's Save leaves them alone. The host's recovery checkpoint retains validated nonsecret settings, while provider credentials and MCP tokens require fresh delivery. An advertised discovery default is not evidence of a particular run's applied model or effort.

## B. Retired provider records

OpenCode, Hermes, and Cursor are no longer product-supported BYO providers. Existing records
remain readable for history and account removal, but they are not offered for new setup or
reconnection and their credentials are not issued to runs. Generic ACP transport remains
available for self-hosted custom adapters. Agent Host and protocol releases remain a lockstep
BYOM compatibility concern; no hosted Cloud image is built or published.

## C. E2B adapter (self-hosting)

`packages/overlay-sandbox-runtime/src/e2b.ts` implements the sandbox runtime on E2B. Set:

```
OVERLAY_MANAGED_SANDBOX_PROVIDER=e2b
E2B_API_KEY=...
OVERLAY_E2B_TEMPLATE=<template configured for this self-hosted deployment>
```

Sandboxes use `onTimeout: 'pause'`, `autoResume: false`; Overlay's own idle meter stops them. Billing uses the E2B rate card in `ManagedAgentSandboxBilling.ts`. Tested against a fake SDK only; not run against real E2B.
