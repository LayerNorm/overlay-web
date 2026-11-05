# Private subscription bridge

This service embeds CLIProxyAPI at `01b24f1f95dc9b309765212c52b25b25e005ff01`.
It is an Overlay-owned stateless bridge, not the stock multi-account proxy.
Every internal endpoint requires `Authorization: Bearer …`; set
`OVERLAY_CLIPROXYAPI_SECRET` to a random value of at least 32 characters.
The service listens on `PORT` or `8317`.

`build.sh` fetches and verifies the pinned source, applies the focused
single-poll shims required by xAI, Kimi/Kimi AI, and Meta device flows, copies
the bridge command into that module, and runs focused tests before building.
Build/cache output stays in `.build/` and is ignored by Docker. No upstream
credential files or manager are initialized. Overlay Vault owns durable
pending state and credentials; the bridge keeps no local auth state and does
not refresh during inference.

The bridge supports the exact provider IDs `codex`, `claude`, `xai`, `meta`,
`kimi`, `kimi-ai`, and `devin`. Codex, xAI, Meta, and Kimi providers use
device authorization; Claude and Devin use generated PKCE authorization and a
locally validated callback URL. Devin session tokens and minted Meta API keys
are represented as non-expiring only when upstream supplies that credential
form. No raw-token paste, localhost callback listener, cross-domain fallback,
or background refresh is used.

The internal `/internal/v1/authorize`, `/poll`, `/complete`, `/refresh`,
`/models`, and `/infer` endpoints are intended only for the bound Overlay web
service. Do not add public rewrites for this service. Model lists come from the
pinned upstream provider catalogs; catalog presence does not establish account
entitlement. The bridge enforces the requested provider and catalog membership
for every inference request.

For a local build with Go 1.26.10 and Git installed, run `./build.sh`. Configure
the web service with the private binding `OVERLAY_CLIPROXYAPI_URL` and set
`OVERLAY_CLIPROXYAPI_SECRET` as a service secret. Neither value belongs in
source control. `OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS` is the explicit
comma-separated deployment allowlist. The supported value is
`codex,claude,xai,meta,kimi,kimi-ai,devin`; only enable IDs approved for that
environment. No Vercel configuration or secrets are defined here.

Workspace-scoped subscription sharing is enforced by the web/Convex control
plane; this bridge remains stateless and does not receive workspace ownership
as a substitute for that authorization. Builds and injected-network tests do
not establish live provider acceptance. Callback UX, provider account
entitlement, refresh behavior, hosted restart and streaming behavior still
require isolated real-account QA. The web scope selector now supports explicit
workspace sharing; the production provider allowlist is unchanged.

New connections offer six choices; Kimi uses `kimi.com`. The `kimi-ai` backend
ID remains bound to `kimi.ai` for existing credentials and reconnects only.
Production/shared Preview enable the six providers by owner authorization; keep
`kimi-ai` in the allowlist for legacy dispatch without showing a second picker
choice. Real authorization-start requests pass for all six; live-account inference
for every provider remains separate from pinned-executor fixture coverage.
