# Data and APIs (Monid)

Agents and chats can find and run thousands of paid third-party endpoints (lead search, enrichment, social and review data, scraping, SEO, 3D and media generation) without the person connecting an account or buying a subscription. Overlay calls [Monid](https://monid.ai/docs), one gateway to those providers, with a single server-side key and a prepaid Monid wallet that Overlay funds. Each run is charged to the Overlay workspace that asked for it.

## Tools

| Tool | Monid call | What it does |
| --- | --- | --- |
| `search_apis` | `POST /v1/discover/endpoints` with `readonly: true` | Ranked matches for a plain-language need, with price, health and typical run time. |
| `inspect_api` | `POST /v1/inspect` | Input JSON Schemas (`body`, `queryParams`, `pathParams`), price, notes, alternatives, and `canRun`. |
| `run_api` | `POST /v1/run`, then `GET /v1/runs/{id}` | Runs the endpoint, waits up to 10 minutes for asynchronous ones, saves files, charges the workspace. |

Code: `src/server/integrations/monid/client.ts` (HTTP client), `src/server/tools/tools/monid.ts` (tools, billing, files), definitions in `src/server/tools/tools/build.ts`. Tool ids are `API_TOOL_IDS` in `@overlay/tools-core/policy`; the agent group is `apis` ("Data and APIs") in `src/shared/agents/tool-groups.ts`.

## Who gets them

- Offered only when Overlay has a Monid key (`MONID_API_KEY`, WorkOS Vault first, then env) and the turn's plan is paid (`withoutUnavailableApiTools` in `act/tooling.ts`). The hosted-provider kill switch also turns them off.
- Personal chat: always in the base set (`exposure-policy.ts`), because requests for them rarely name a tool.
- Agents: the `apis` group. New agents get it; agents saved before it existed must turn it on.
- Outside apps over MCP: the Everything level.
- Shared rooms: allowed. Runs touch no private data; files land in workspace Files there.

## Read-only only

Overlay has one Monid workspace for all customers. Endpoints that are not read-only create, change or delete resources in that shared workspace (phone numbers, inboxes, file systems, machines, browser profiles), or act outside their answer (calls, messages, letters, bookings). Running them would let one customer reach another's resources and run up recurring charges nobody meters. So:

- `search_apis` asks Monid for read-only endpoints only.
- `run_api` refuses any endpoint in Monid's non-read-only catalog (`GET /public/v1/endpoints?readonly=false`, cached 10 minutes). If that catalog cannot be read, it refuses everything (fail closed).
- `inspect_api` reports `canRun: false` with the reason.

Running side-effecting endpoints needs per-customer resource isolation at Monid first; it is not built.

## Billing

Workspace budget only, like `web_search`:

1. Before: `generationUsagePolicy.ensureBudgetNotLow` (refuses under 2%, a spending limit used up, or a free plan).
2. `maxCost` on the run is the workspace's remaining budget with the usage markup taken back out (`remainingCents / 100 / (1 + markup)`). It is a hard cap, not an estimate: Monid refuses (400 `MAX_COST_EXCEEDED`, nothing charged) a run the workspace could not pay for. Not sent when billing is disabled.
3. After: `generationUsagePolicy.charge` with `billing.reportedCost` as `providerCostUsd`, so `OVERLAY_USAGE_MARKUP_BPS` applies. The usage label is `monid/<provider><endpoint>`. The operation id is `monid.run:<runId>`, so a charge is never counted twice.

Runs Monid does not charge (failed, timed out, blocked, stopped, provider 402) report zero and cost the workspace nothing. The idempotency key is `overlay-<toolCallId>`, so a retried tool call returns the original run instead of paying twice. Each run carries `tag: <workspaceId>` to match Monid's records to ours.

## Results

- Files in the output (objects with `download_link`) are downloaded through the SSRF guard (`createGuardedFetch`, 100 MB, at most 10 per run) and saved with `FileService.createFileFromBytes`: personal Files normally, workspace Files in a shared room, marked as by an agent when one ran it. The output carries `{ file: { fileId, url, name } }` in their place, and the signed Monid link is dropped. Chat shows a card for each.
- Output over 40,000 characters of JSON is saved whole to Files as `<provider-endpoint>-<runId>.json` and only a preview is returned; the agent reads the rest with `read_file`.
- Everything a run returns is untrusted data; the instructions say so.

## Operations

- Account problems (401, 402 wallet empty, 403) are logged as `[monid] account problem` errors and shown to agents as "temporarily unavailable". They affect every workspace at once: keep auto top-up on in the Monid dashboard and alert on that log line.
- A run blocked by a Monid workspace control logs `[monid] run blocked`. Overlay sets no Monid-side controls; the workspace budget is the limit.
- A completed run without `reportedCost` logs an error: it would otherwise be free.
- To turn the tools off, remove the key (Vault and env) or use the hosted-provider kill switch.

## Open

- Side-effecting endpoints (above).
- Monid's reseller and data-licensing terms have not been confirmed in writing.
- Monid publishes no numeric rate limits or synchronous timeout; a single 429 with `Retry-After` up to 5 seconds is retried.
