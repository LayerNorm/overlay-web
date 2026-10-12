# Overlay MCP access for other AI apps

Overlay is an MCP server for the person's own workspace, so ChatGPT, Claude (web and desktop), Cursor, Claude Code, Codex, and any other MCP client can read and write their notes, files, memory, and knowledge. `/api/agent-mcp` (per-run tokens for connected agents) is a separate server that shares the protocol code.

## Address and sign-in

- MCP endpoint: `<app url>/api/mcp` (Streamable HTTP, stateless, JSON responses; `GET`/`DELETE` are 405).
- **OAuth 2.1** for hosted and desktop apps: protected-resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource[/api/mcp]`, authorization-server metadata (RFC 8414) at `/.well-known/oauth-authorization-server` (also served at `openid-configuration`), dynamic client registration (RFC 7591) at `/api/oauth/register`, authorization at the `/oauth/authorize` consent page, token endpoint `/api/oauth/token`. PKCE S256 is required; clients are public (no secret).
- **Personal tokens** for local agents that skip OAuth: Settings → Connected apps → Create a token (`ovmcu_p_…`, up to 365 days, shown once), sent as `Authorization: Bearer`.
- An unauthenticated or invalid call is 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, which is how an OAuth-capable client finds where to sign in.

## What a connection is

Consent binds one person, one workspace (personal or team), and one **access level**:

| Level | Tools |
| --- | --- |
| Read only | search and read memory, knowledge, files, notes, skills, automations. Nothing is changed or spent. |
| Read and write | read, plus notes, files, memory, skills writes and web search. |
| Everything | write, plus automations, connected apps, the person's MCP servers, image and video generation, the browser. |

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

## Verifying

`mcpGrants` Convex tests, `McpAccessService`, token, and access-level unit tests cover the rules above. Live checks against a dev backend: the full flow with the official `@modelcontextprotocol/sdk` client (discovery, registration, PKCE, refresh after a 401, tool calls), read/write/everything tool lists, real note/file/memory tool calls, revocation, and Claude Code on a Boat machine reporting the server connected over a public tunnel.
