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

## Model choice

A Claude Code or Codex agent's model is stored in its `modelId` as `byo/<adapter>#<model>` (`src/shared/agents/agent-model.ts`; no suffix means the agent's default). `workspace-agent-invocation.ts` sends it as `metadata.model`; the host calls acpx `runtime.setModel` after opening the session (`acpx-adapter.ts`). Ids are the agent's own: Claude Code `default | opus[1m] | claude-fable-5-1 | sonnet | haiku` (from its `session/new` config options), Codex `slug[effort]` such as `gpt-6-sol[high]` (from codex-acp's model list). The lists are static in `agent-model.ts`; refresh them from a machine when the agents add models (`codex debug models` for Codex; `session/new` for Claude Code). Codex on a ChatGPT sign-in advertises plain model names (`gpt-6-sol`) while an API key advertises `gpt-6-sol[high]`, so the host (`applyRequestedModel`, since 0.3.10) applies `name[level]` as given and, when that is not offered, applies the name and sets the level as the reasoning effort (best effort). Overlay-access and model are saved by their own controls on the agent page, so the editor's Save leaves them alone.

## B. Experimental bring-your-own-key agents

OpenCode and Hermes run on an OpenRouter key (`OPENROUTER_API_KEY`); Cursor on `CURSOR_API_KEY`. They are marked `experimental` in `src/shared/agents/provider-accounts.ts`. The host maps them through acpx (`ACPX_SYSTEM_AGENT_NAMES`, `ACPX_AGENT_LAUNCH_OVERRIDES` — Hermes needs a launch override — in `packages/overlay-agent-host/src/acpx-adapter.ts`). The machine image already contains these CLIs. Host and protocol packages are 0.3.10; the image bakes the host in, so it is `overlay-agent-v5` (host 0.3.10; v2 machines run only Claude Code and Codex).

**Live results (2026-10-03, production).** OpenCode on OpenRouter ran end to end: it answered as `deepseek/deepseek-v4-flash` (the default model set in `agentProviderEnv`). Cursor is untested (no key). **Hermes does not work yet**: its installer, run lazily on first use, fails on the Boat base layer (it downloads Python 3.14 and cannot unpack it), so the host's `hermes acp --check` fails and the machine never enrolls. Pre-installing it with uv's Python and cache directories on the real disk did not help (the base layer's filesystem drops files while uv unpacks), so Hermes is dropped for now. It is hidden from the pickers (`SELECTABLE_AGENT_PROVIDER_IDS`); backend support remains. The image is `overlay-agent-v5` because the host is baked into it. Found by the live run: the API boundary only accepted `claude-code` and `codex`.

## C. E2B adapter (self-hosting)

`packages/overlay-sandbox-runtime/src/e2b.ts` implements the sandbox runtime on E2B. Set:

```
OVERLAY_MANAGED_SANDBOX_PROVIDER=e2b
E2B_API_KEY=...
OVERLAY_CLOUD_AGENT_IMAGE=overlay-agent:v5     # printed by the build script
npx tsx infra/agent-image/build-e2b.mts        # builds the template
```

Sandboxes use `onTimeout: 'pause'`, `autoResume: false`; Overlay's own idle meter stops them. Billing uses the E2B rate card in `ManagedAgentSandboxBilling.ts`. Tested against a fake SDK only; not run against real E2B.
