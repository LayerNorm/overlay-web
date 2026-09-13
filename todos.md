# Billing TODOs

## Box (ascii.dev) computer billing — deferred, nontrivial

The `box` sandbox runtime (`packages/overlay-sandbox-runtime/src/box.ts`) reports
`usage: false` — it tracks lifecycle + command timing but exposes no provider
usage metrics. To bill computer usage:

- Meter running seconds per Box; stopped Boxes are free.
- Price by machine size: default $0.036/hr, small $0.018/hr, large $0.072/hr,
  xlarge $0.20/hr (per-second, machine-time multipliers).
- Decide retail mapping: provider cost + 25% markup vs flat retail rate.
- Box balances are org-level shared machine-time pools ($1 = 100,000s); their
  `/limits` endpoint exposes remaining machine time/credits/concurrency — sync
  or reconcile against Overlay's own ledger.
- Wire into `ManagedAgentSandboxBilling` alongside the Daytona/Vercel paths and
  emit `sandbox`/`generation` usage events so Boxes appear on the itemized
  usage statement.

## Tool-invocation budget gating

Composio tool calls are billed post-hoc at $0.0003/call (clamped to remaining
balance). Calls that execute while the wallet is empty are recorded but not
charged. A pre-execution budget check in the tool loop would close that gap.

## MCP tool calls outside `conversations/act`

Done: `workspaceId` now flows through `createMcpLazyMetaTools` →
`buildMcpToolsContext` → the `call_mcp_tool` contextSchema, so MCP calls inside
org workspaces bill the workspace wallet. The eager `createMcpToolSet` path
(prewarm) still has no workspace context — it is a cache-warmer and records
under the personal account if it ever runs live.
