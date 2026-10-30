# Overlay Free model routing

Onboarding does not call this router. Its questions, employee suggestions, and
starter tasks are scripted, so every user gets the same flow for the same answers.

Chat titles also bypass this router. Budget-authorized paid accounts use GLM 5.3
Flash with one bounded attempt and normal usage settlement. Free accounts, denied
reservations, empty results and failed requests use a short excerpt of the first
message instead of leaving the conversation named "New Chat".

Overlay Free uses the configured AI Gateway and OpenRouter credentials from the
web runtime. The private hourly refresh callback requires `OVERLAY_BFF_URL` and
the existing `INTERNAL_API_SECRET`. Missing configuration or Convex safety
storage makes routing unavailable; it does not authorize stale catalog state.
Preview deployments do not schedule probes, but can initialize route state
through an authenticated refresh or first use.

Refresh reads current provider catalogs, verifies explicit zero pricing and
capabilities, and probes a bounded set of Gateway endpoints. Gateway routes
remain unavailable until a successful zero-cost canary. OpenRouter Free is a
separate selectable model and does not use the Gateway transport. A route is
claimed atomically for one request at a time; busy routes are skipped. A request
lease lasts up to three minutes. After semantic output, the idle timeout is 90
seconds, while the lease timer still aborts 15 seconds before lease expiry. An
unresolved expired lease permanently quarantines that route.

Server-side capacity discovery includes busy and cooled routes so the router can
classify claim rejections. Claims continue to refuse busy or cooled routes and
never grant a lease while a route is cooling down.

Before semantic output, the stream buffers at most 32 distinct metadata/start
parts and 64 KiB; identical parts count once. After output begins, metadata passes
through without consuming that prelude budget. Fallback resets the buffer and
deduplication state.

For an interrupted semantic OpenRouter stream, the router may confirm cost only
when the route has explicit zero prompt and completion pricing and a valid
OpenRouter generation ID was captured. It polls OpenRouter's generation endpoint
up to six times, two seconds apart, with five-second request timeouts, and skips
the lookup unless its full bound fits before the lease's 15-second safety margin.
Only an exact matching generation with numeric total cost zero, `is_byok: false`,
and null or zero upstream inference cost is confirmed. A confirmed interruption
settles a safe zero-cost receipt, releases the lease without quarantine, and
surfaces a distinct interruption for Harness retry. Caller aborts and stream
cancellation do not trigger a lookup. Missing, invalid, ineligible, or late cost
confirmation retains the existing unsafe settlement and quarantine behavior.

The safety checks reduce risk but cannot guarantee zero spend. Providers may
change pricing between preflight and execution, and the first request can be
charged before its receipt is checked. Unsafe or missing receipts still quarantine
the route. Quarantine recovery is performed through the internal
`clearRouteQuarantine` mutation by a trusted operator after reviewing current
provider pricing and receipts. The expected quarantine reason is required as a
guard, and there is no public reset endpoint.
