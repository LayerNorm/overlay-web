# Codex subscription and E2B

Credential brokerage, retired provider records, and the E2B self-hosting
adapter are three independent parts of the connected-agent system.

## A. Codex on a ChatGPT subscription (credential broker)

**Problem.** Codex signs in with ChatGPT and keeps `auth.json` with a refresh token that *rotates*: each refresh invalidates the previous one. Two machines holding the same token would break each other. So no machine holds the real refresh token — Overlay does.

**Sign-in.** Device-code flow against `https://auth.openai.com` (client id `app_EMoamEEZ73f0CkXaXp7hrann`). `POST /api/v1/provider-accounts/codex-sign-in` with `action: start` returns a code and `https://auth.openai.com/codex/device`; the person approves there; `action: poll` returns `pending` until approved, then exchanges the code and stores the token set. The Agent accounts dialog does this; pasting a Codex subscription secret is refused (`use_sign_in`).

**Storage.** One vault secret per account (JSON `CodexTokenSet`). Convex holds metadata and the opaque reference only.

**Refresh.** `AgentProviderAccountService.freshCodexTokens` refreshes server-side when the access token expires within 25 minutes. A Convex lease (`refreshLockOwner` / `refreshLockUntil` on `agentProviderAccounts`, `acquireRefreshLockByServer` / `releaseRefreshLockByServer`) lets exactly one run refresh at a time; others wait up to 20 s then reread. New tokens are stored *before* the lock is released. A rejected refresh (`invalid_grant`, 400/401) flags the account `needs_reauth`; a transient failure does not.

**Delivery.** On `issueRunCredentials` or idle bound-adapter option discovery the app server writes a per-run `/home/user/.codex/auth.json` to the machine through `deliverMachineFiles` (`CloudAgentMachineService.writeFiles`; paths must be under `/home/user/`). It holds a fresh access token and a **placeholder** refresh token, so a machine can never rotate the real one. Codex only refreshes after 8 days or on a 401; a placeholder refresh therefore fails harmlessly and the next run gets a new file. The signed credential endpoint accepts an exclusive run id or adapter id. Discovery uses only the unique enabled binding on that Cloud environment and refuses active work; callers cannot select an account or owner. Existing run requests and credential method scopes remain compatible.

**Known limit.** `auth.json` (with a short-lived access token) stays on the machine's disk after a catalog probe or run, until the next broker delivery overwrites it.

Protected PR Preview hosting access is separate from Codex sign-in. The compatible host consumes
a private one-shot access file before starting adapters and keeps hosting headers on its exact
Preview API origin; MCP crosses a host loopback relay with the original run token. Neither the
provider environment nor Codex `auth.json` contains the hosting credential. Fresh-image acceptance
is required before claiming unattended Preview enrollment; a manual QA bootstrap is insufficient.

**Verification status.** Unit and Convex tests cover the flow, the lock, and delivery. Live verification (a real ChatGPT approval, and two Codex agents on one account) needs the account owner to approve a device code; record the result here when done.

## Model choice

A connected agent stores its model as `byo/<adapter>#<model>`; no suffix selects the agent's default. The bound environment's advertised catalog supplies the model, permission and effort controls. Static legacy choices are only a fallback before discovery; an agent that reports no catalog must not inherit an invented list.

Modern Codex catalogs can report a base model and a separate effort selector. Older saved choices such as `gpt-6-sol[high]` remain valid: preserve an exact advertised id first, otherwise resolve its base and effort only when both are offered. The UI displays that effective pair and preserves effort on model changes; an explicit saved effort overrides the older suffix. Missing models or effort levels stay visibly unsupported. The host applies choices through ACP configuration and rejects vendor errors rather than silently using another setting.

Model, effort, permissions and Overlay access save independently for the next turn; the identity editor's Save leaves them alone. The host's recovery checkpoint retains validated nonsecret settings, while provider credentials and MCP tokens require fresh delivery. An advertised discovery default is not evidence of a particular run's applied model or effort.

## B. Retired provider records

OpenCode, Hermes, and Cursor are no longer product-supported BYO providers. Existing records
remain readable for history and account removal, but they are not offered for new setup or
reconnection and their credentials are not issued to runs. Generic ACP transport remains
available for self-hosted custom adapters. The source update prepares Agent Host/protocol `0.4.3`
and image v10 with Claude ACP `0.93.0` and Codex ACP `2.2.2`; publication and machine rollout
are separate work. Existing machines should upgrade only when idle.

## C. E2B adapter (self-hosting)

`packages/overlay-sandbox-runtime/src/e2b.ts` implements the sandbox runtime on E2B. Set:

```
OVERLAY_MANAGED_SANDBOX_PROVIDER=e2b
E2B_API_KEY=...
OVERLAY_CLOUD_AGENT_IMAGE=overlay-agent:v5     # printed by the build script
npx tsx infra/agent-image/build-e2b.mts        # builds the template
```

Sandboxes use `onTimeout: 'pause'`, `autoResume: false`; Overlay's own idle meter stops them. Billing uses the E2B rate card in `ManagedAgentSandboxBilling.ts`. Tested against a fake SDK only; not run against real E2B.
