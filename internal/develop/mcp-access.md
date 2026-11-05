# Overlay MCP access for other AI apps

Overlay is an MCP server for the person's own workspace, so ChatGPT, Claude (web and desktop), Cursor, Claude Code, Codex, and any other MCP client can read and write their notes, files, memory, and knowledge. `/api/agent-mcp` (per-run tokens for connected agents) is a separate server that shares the protocol code.

## Two servers, at a glance

Overlay runs **two MCP servers inside the Next.js app**, plus it is an **MCP client** for the person's own servers.

| | `/api/mcp` | `/api/agent-mcp` |
| --- | --- | --- |
| For | Outside AI apps (ChatGPT, Claude, Cursor, local agents) | Claude Code / Codex agents on user-owned hosts connected through Agent Host |
| Sign-in | OAuth 2.1 (dynamic registration, PKCE, rotating refresh) or a personal token (`ovmcu_p_…`) | A per-run token (`ovmcp_…`) the Agent Host hands the agent; stops working when the run ends |
| Who it acts as | The person who connected it, in one workspace, at one access level | The person who summoned the agent, limited to the agent's grant |
| Tools | Read / Read and write / Everything (see `tool-catalog.md`) | The agent's grant, same pipeline as a native agent |
| Approvals | Refused with an explanation (no Overlay conversation to show a card) | A real approval card in the conversation |

Both speak MCP over **Streamable HTTP**, stateless, JSON responses: `initialize`, `tools/list`, `tools/call`, `prompts/list`, `prompts/get` (the person's skills are offered as prompts). `GET` and `DELETE` are 405. There are no MCP resources. Shared code: `src/server/mcp/mcp-jsonrpc.ts`, `mcp-http.ts`; tools are the native pipeline adapted by `adaptToolsForMcp` (`src/server/agents/agent-mcp-tools.ts`).

**Overlay as an MCP client**: the person connects their own MCP servers in settings; chats and agents reach them through `search_mcp_tools` and `call_mcp_tool` (`src/server/tools/mcp-tools.ts`), with per-tool approval policy. An MCP server a member shares with the workspace (scope `workspace`) is usable by every member's chats and agents; it is called with its creator's credentials from Overlay's server, members and models never receive them, and archiving or disabling it withdraws it from everyone.

## Address and sign-in

- MCP endpoint: `<app url>/api/mcp` (Streamable HTTP, stateless, JSON responses; `GET`/`DELETE` are 405).
- **OAuth 2.1** for hosted and desktop apps: protected-resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource[/api/mcp]`, authorization-server metadata (RFC 8414) at `/.well-known/oauth-authorization-server` (also served at `openid-configuration`), dynamic client registration (RFC 7591) at `/api/oauth/register`, authorization at the `/oauth/authorize` consent page, token endpoint `/api/oauth/token`. PKCE S256 is required; clients are public (no secret).
- **Personal tokens** for local agents that skip OAuth: Settings → Connected apps → Create a token (`ovmcu_p_…`, up to 365 days, shown once), sent as `Authorization: Bearer`.
- An unauthenticated or invalid call is 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, which is how an OAuth-capable client finds where to sign in.

`/.well-known/openid-configuration` re-exports the canonical
`oauth-authorization-server` route's GET/OPTIONS handlers. Both discovery
addresses use the same request-time configuration and preflight behavior.

## What a connection is

Consent binds one person, one workspace (personal or team), and one **access level**:

| Level | Tools |
| --- | --- |
| Read only | search and read memory, knowledge, files, notes, skills, automations. Nothing is changed or spent. |
| Read and write | read, plus notes, files, memory, skills writes and web search. |
| Everything | write, plus automations, connected apps, the person's MCP servers, image and video generation. |

A level is a tool grant in the same shape an Overlay agent holds (`mcpToolGrantFor`, `src/shared/mcp/access.ts`), so the app gets the same tools through the same pipeline (`prepareActTooling`), policy, and entitlements as an Overlay agent with that grant: a level only narrows what the workspace allows. Never offered at any level: computer tools, agent editing (`create_agent`/`update_agent`, which would let an outside app rewrite what Overlay's agents may do), `present_generated_ui`, and tools that need an Overlay conversation (`draft_*_from_chat`). Tools whose server policy needs approval are refused with an explanation: an outside app has no Overlay conversation to show Overlay's approval card in (connected agents, which do, get a real approval round trip; see `bring-your-own-agents.md`). Memory belongs to the person, so every connected app shares it.

Use the address Settings shows (`https://www.getoverlay.io/api/mcp` on production): the apex redirects to `www`, and strict OAuth clients compare the resource they were told with the address they called. The advertised URLs are built from the host the request arrived on, limited to the app's own host and its `www` twin.

## Skills as prompts

The person's enabled Overlay skills are offered as MCP prompts (`prompts/list`, `prompts/get`) at every access level, since a prompt is text the person chooses to run. Claude shows them as `/mcp__overlay__<skill>`. Connected agents get the same prompts when their grant includes skills. Prompts need no write into the client's own skill folders.

## Security model

- Tokens, codes, and client ids are HMAC envelopes (`src/server/mcp/mcp-tokens.ts`; signing secret `OVERLAY_MCP_OAUTH_SECRET`, falling back to the internal service secrets). The kind is part of the signature, so one kind cannot be presented as another.
- Revocation and single use live in `mcpGrants` (Convex). Access tokens (1 h) and personal tokens carry only the grant id and are checked against the row on every request, together with the person's current membership in the workspace. Refresh tokens (30 d) rotate: reusing an old one revokes the grant. An authorization code (60 s) redeems once; a second redemption revokes the grant it made.
- Redirects must exactly match a URI registered at client registration (https, `http` on localhost, or an app scheme; never `javascript:`, `data:`, `file:`). The consent page never redirects to an unverified URI.
- Rate limits: per grant on `/api/mcp`; loose per-IP backstops on registration and token exchange because hosted apps share egress IPs across all their users.
- Account deletion removes the person's grants; tokens also die with their workspace membership.
- Users see, name, and revoke every connection in Settings → Connected apps.

## CN-21 settings ownership

Native MCP settings use `integrations/nativeMcpServers:list/get/updateMetadata/changeScope` and `mcp/grants:listNative/revokeNative`. MCP server metadata/scope calls derive the viewer from Convex authentication, recheck active human membership in the selected workspace, and enforce `mcp.use` through the deployment capability policy. Grant listing/revocation remains authenticated and owner/workspace-checked without adding an `mcp.use` requirement, matching the `/mcp/connections` contract. Shared MCP metadata is readable by active members, not guests; owners edit their personal entries, and workspace owners/admins may edit shared entries. A native capability failure is a local settings-surface error, never a signal to fall back to HTTP.

The MCP summary is an allowlisted projection, not a stored record. It includes the endpoint origin only: path, query, fragment, and userinfo may contain credentials. It excludes auth configuration, encrypted credentials and OAuth tokens/client, client/issuer/scope/resource values, raw tool schemas, and raw provider errors. Catalog and OAuth failures become generic text. Connected Apps returns only grant id, client display name, grant kind/access, workspace, creation/last-use/expiry timestamps; it never returns OAuth client ids, authorization codes, or refresh versions. Revocation is derived from native identity, scoped to the grant owner and an active human workspace membership, audited as `mcp.grant.revoked`, and idempotent.

Native writes own app-managed metadata and scope only. Each update requires `expectedUpdatedAt`, compares it to the current revision, and strictly advances `updatedAt`; the revision captured when a dialog opens remains its write revision even as subscriptions deliver newer rows. A stale write is rejected with a safe reopen/reload message rather than overwriting new work. Verified-user writes are rate-limited and audited because native calls bypass BFF IP throttling. Optimistic enable/revoke updates touch only the matching cached entity/page; Convex mutation rollback restores the authoritative value on failure.

Creation, permanent deletion, URL/transport/auth changes, credentials, OAuth, and external connection tests remain behind authenticated server routes. Those routes derive the active workspace and owned server record; changed endpoints do not receive saved bearer/OAuth credentials. Stored endpoint tests submit `useStoredConfig`, and the server replaces the redacted origin with the owned stored configuration. The server-only MCP command lifecycle records pending and final test/connect/disconnect status, rejects concurrent live commands, and expires abandoned pending work after five minutes. A successful connect command means an authorization URL was issued or an already-authorized state was confirmed; it does not mean the provider callback completed. Persisted OAuth status remains authoritative for whether the app is connected. Failures shown to the browser are generic.

Legacy HTTP APIs remain in place for native-auth-disabled installations and for non-settings consumers, including private/shared-composer and other server paths. Settings selects its native surface only when native auth is configured; a configured but unavailable Convex client renders a local unavailable state. The host exports `useNativeMcpServers`, its safe summary, and availability state for the shared-composer integration; the shared composer itself remains outside this migration. Native lists use paginated subscriptions (30 rows initially, 100 maximum per page); cost grows with pages actually loaded and membership/scope checks on each bounded page, not with all records in the workspace. Do not infer full workspace state from one page.

Rollback by restoring the settings routes/components to the legacy HTTP-backed surfaces and retaining the existing APIs. The command-state schema is additive and optional: no backfill or destructive cleanup is required. Re-enable native surfaces only after capability policy, query permissions, workspace remounting, and external server boundaries are available together.

CN-21 focused tests cover native identity/capability and membership checks, shared read/edit separation, redaction, stale revisions, grant projection/revoke audit/idempotency, command ownership/final state, endpoint credential isolation, generic external failures, and optimistic cache targeting. Remaining QA gaps are browser acceptance for both native-auth configured/unavailable and legacy modes, workspace-switch/reactive subscription behavior, visual dark/light review, and live OAuth/provider callback behavior. These require the merged parent capability policy and an isolated test deployment; they are not established by the local fixtures.

## Verifying

`mcpGrants` Convex tests, `McpAccessService`, token, and access-level unit tests cover the rules above. Live checks against a dev backend: the full flow with the official `@modelcontextprotocol/sdk` client (discovery, registration, PKCE, refresh after a 401, tool calls), read/write/everything tool lists, real note/file/memory tool calls, revocation, and Claude Code on a Boat machine reporting the server connected over a public tunnel.
