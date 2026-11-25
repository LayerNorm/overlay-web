# Monid as native tools

Status: Built and unit-tested on `codex/monid-native-tools`. Not merged, not deployed. Live runs against Monid and preview QA wait on a Monid key and a funded wallet.

How it works now lives in the living doc `internal/develop/monid.md`. This plan tracks what is left.

## Goal

People can ask Overlay for things that need a paid API (finding leads, enriching a company, scraping a site, generating a 3D model) without connecting an account, buying a subscription or adding an MCP server. Overlay runs them through Monid with one server-side key and a prepaid wallet it funds, and charges each run to the workspace at Monid's reported cost plus the standard usage markup.

## Decisions made while building

- Tool names are `search_apis`, `inspect_api` and `run_api`; the group is "Data and APIs" (`apis`).
- Read-only endpoints only. Overlay's one Monid workspace is shared by every customer, so endpoints that create, change or delete resources there, or that send messages, place calls or make bookings, are refused (fail closed when Monid's catalog cannot be read). This removed the need for an approval step. Running them later needs per-customer resource isolation.
- Monid image, video and audio generation endpoints are among the refused ones (Monid stores their output as a resource). Overlay's own media tools cover those; 3D generation (Meshy) is read-only and runs.
- No wallet webhook: account problems (401, 402, 403) log `[monid] account problem` and tell the agent the service is temporarily unavailable. The kill switch is the existing hosted-provider switch or removing the key, not a new flag.
- Personal chat always offers the tools on paid plans, since such requests rarely name a tool. Agents saved before the group existed must turn it on.

## Progress

| Phase | Work | Status |
| --- | --- | --- |
| 0. Verify | API shapes checked against Monid's OpenAPI spec and public catalog (`input` uses `{ body, queryParams, pathParams }`; ~4% of endpoints are not read-only). Live run with a key, timeouts and file expiry not yet checked. Reseller and data-licensing terms not yet confirmed in writing. | Partly done |
| 1. Client | `src/server/integrations/monid/client.ts` with typed errors, one short 429 retry, idempotency keys, side-effect catalog paging. | Built, unit-tested |
| 2. Tools and billing | Three tools, budget check, `maxCost` from remaining budget, charge of `reportedCost` per run id, polling with stop on timeout or cancel, files saved to Files, large output saved whole. | Built, unit-tested |
| 3. Access | Tool group, paid-plan and key gating, personal exposure, MCP Everything level, run modes, chat rows and file cards, instructions, self-verticalize skill. | Built, unit-tested |
| 4. Operations | Error logs for account problems; auto top-up must be turned on in the Monid dashboard. | Built; dashboard setting pending |
| 5. QA and launch | Preview QA with the Preview key: side-effect endpoint refused, lead search with a provider error the agent corrected, 3D generation. QA found two bugs, both fixed with tests: asynchronous runs were not charged (`GET /v1/runs` reports `cost`, not `billing.reportedCost`), and linked files (Meshy `model_urls`) were not saved, now handled by `save_api_file`. Re-test of both, plus large output, in progress. | In progress |

## Remaining

1. Create the Monid account, fund the wallet, turn on auto top-up, create a key, and add it as `MONID_API_KEY` to Vercel Preview and Production (or WorkOS Vault).
2. Preview QA as in phase 5, then merge and verify in production.
3. Confirm Monid's reseller and data-licensing terms.
