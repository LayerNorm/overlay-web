# Private Codex subscription bridge

This service embeds CLIProxyAPI at `01b24f1f95dc9b309765212c52b25b25e005ff01`.
It is an Overlay-owned stateless bridge, not the stock multi-account proxy.
Every internal endpoint requires `Authorization: Bearer …`; set
`OVERLAY_CLIPROXYAPI_SECRET` to a random value of at least 32 characters.
The service listens on `PORT` or `8317`.

`build.sh` fetches and verifies the pinned source, applies the small Codex
device-flow shim, copies the bridge command into that module, and runs focused
tests before building. Build/cache output stays in `.build/` and is ignored by
Docker. No upstream credential files or manager are initialized. Overlay Vault
owns durable pending state and credentials; the bridge keeps no local auth
state and does not refresh during inference.

The internal `/internal/v1/authorize`, `/poll`, `/refresh`, `/models`, and
`/infer` endpoints are intended only for the bound Overlay web service. Do not
add public rewrites for this service. Model lists come from the pinned upstream
plan catalogs; catalog presence does not establish account entitlement.

For a local build with Go 1.26.10 and Git installed, run `./build.sh`. Configure
the web service with the private binding `OVERLAY_CLIPROXYAPI_URL` and set
`OVERLAY_CLIPROXYAPI_SECRET` as a service secret. Neither value belongs in
source control. The Codex provider gate must also include `codex` before the
subscription feature is enabled.
