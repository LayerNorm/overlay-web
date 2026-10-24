# Features and release controls

Living inventory of product surfaces, release switches and providers. Update this file whenever a feature, provider or release default changes.

**Status describes checked-in defaults, not a production audit.** Enabled means implemented and enabled in the default config, subject to credentials, workspace permissions, billing and provider availability. Disabled means opt-in or awaiting release acceptance, not necessarily unimplemented. No environment values or secrets belong here.

## How controls work

- Runtime features: `features.<key>` in [defaultOverlayRuntimeConfig.ts](src/shared/config/defaultOverlayRuntimeConfig.ts). Environment overrides are mapped in [env-overrides.ts](src/server/config/env-overrides.ts). In the tables, a suffix such as `CHAT` means `OVERLAY_FEATURE_CHAT`.
- Precedence: checked-in defaults, JSON file, remote config, environment overrides. Config changes require a fresh deployment. See [loadOverlayConfig.ts](src/server/config/loadOverlayConfig.ts).
- UI flags: `featureFlags` in [overlay.config.ts](src/overlay.config.ts), layered over [app-shell.ts](packages/overlay-app-core/src/app-shell.ts). These are not authorization checks.
- Server capabilities and service policy enforce availability; a hidden control is not security. Some flags only describe availability or tool exposure, not a complete API kill switch. Consult the service before using an unrelated flag as an incident control.
- Billing entitlements remain separate. Paid status never overrides an unreleased external runtime. PostHog's [release-flag wrapper](src/server/releases/feature-flags.ts) exists but is not the launch controller; there is no Vercel Flags integration.

## Overlay-only launch

Native Overlay agents and their computers stay available. Only external agent runtimes are withheld, whether on Overlay Cloud or a user's machine. Choosing a Claude/OpenAI model inside an Overlay agent is **not** an external runtime. Work, chats, files, automations, integrations and collaboration are unchanged. Onboarding stays horizontal.

Native tool calls persist successful output and terminal failures across streamed steps. Invalid tool names or malformed inputs are recorded as errors instead of remaining in progress, and recovery guidance names only tools exposed in the current turn.

| Feature / surface | Default status | Runtime key / env suffix | Provider and dependencies |
| --- | --- | --- | --- |
| Native Overlay agents | Enabled | UI `agents`; no external-runtime dependency | Overlay agent runtime, configured model gateway, Convex |
| Native agent computers | Enabled, credentials required | `computers` / `COMPUTERS` | Boat (`box`), `OVERLAY_COMPUTER_PROVIDER=box`, `BOAT_API_KEY` (legacy `BOX_API_KEY` fallback) |
| External runtimes, all hosting modes | Disabled for launch | `externalAgents` / `EXTERNAL_AGENTS` | Master release gate above the existing switches below |
| Connect own machine/VPS, enrollment, bindings, agent accounts | Disabled for launch | `connectedAgentControlPlane` / `CONNECTED_AGENT_CONTROL_PLANE` plus master gate | Overlay Agent Host; external harnesses such as Claude Code and Codex; not native model BYOK |
| External execution: chat, mentions, delegation, schedules, queued starts | Disabled for launch | `remoteAgentRuns` / `REMOTE_AGENT_RUNS` plus control plane/master/rollout | Host adapters; external records never fall back to native execution |
| External agents on Overlay Cloud | Disabled for launch | `overlayCloudEnvironments` / `OVERLAY_CLOUD_ENVIRONMENTS` plus all execution gates | Boat or E2B managed runtime, paid entitlement, budget and provider/image configuration |
| Connected-agent artifacts | Disabled, security release gate pending | `connectedAgentArtifacts` / `CONNECTED_AGENT_ARTIFACTS` | Object storage; requires malware scanning/content validation before release |
| Connected-agent drive | Disabled, opt-in | `connectedAgentDrive` / `CONNECTED_AGENT_DRIVE` | Connected host/drive integration; not native Files or computer storage |
| Legacy managed harness agents | Retired, inert compatibility flag | `managedHarnessAgents` / `MANAGED_HARNESS_AGENTS` | Do not enable. Replacement is the connected cloud-agent path |

Launch hides the Type/Other agent selector, external harness/machine/account setup, and external environment settings. Native Model, Tools and Computer controls remain. Existing external records/history are retained, with new execution rejected. Authorized cancellation, machine stop/delete, revocation, cleanup and usage settlement remain available; read access does not imply permission to restart a runtime.

### Re-enable external agents later

1. Complete the provider/host and security acceptance in [Bring Your Own Agents](internal/develop/bring-your-own-agents.md), including current-preview enroll, approve, bind, run, cancel, revoke and cost settlement. Do not enable retired harnesses.
2. On an isolated preview first, set `OVERLAY_FEATURE_EXTERNAL_AGENTS=true`, `OVERLAY_FEATURE_CONNECTED_AGENT_CONTROL_PLANE=true` and `OVERLAY_FEATURE_REMOTE_AGENT_RUNS=true`.
3. Set `OVERLAY_CONNECTED_AGENTS_ROLLOUT_STAGE=internal` and populate `OVERLAY_CONNECTED_AGENTS_INTERNAL_WORKSPACE_IDS`. Later use `invited` with `OVERLAY_CONNECTED_AGENTS_INVITED_WORKSPACE_IDS`, then `general`. Missing/invalid stage defaults to `off`; internal workspaces remain eligible during invited rollout.
4. For external cloud agents only, also set `OVERLAY_FEATURE_OVERLAY_CLOUD_ENVIRONMENTS=true` and configure `OVERLAY_MANAGED_SANDBOX_PROVIDER=box` or `e2b`, its credentials and supported image/template. Keep cloud off for a BYO-only rollout.
5. Enable artifacts/drive separately only after their own acceptance. Do not change native `COMPUTERS`, general `SANDBOXES`, model provider connections or app-shell `agents` to release external agents.
6. Redeploy, verify the exact revision and isolated backend, then test eligible and ineligible workspaces plus direct API denial. Promote through the [Development Workflow](internal/develop/Development%20Workflow.md); production activation is a separate release action.
7. To withdraw external availability, set `OVERLAY_FEATURE_EXTERNAL_AGENTS=false` and redeploy. Retain credentials needed to stop/clean up existing resources and settle usage. Existing individual kill switches and rollout `off` remain additional controls.

## Product and platform inventory

All runtime feature keys are listed below or in the launch table above. Related rows share providers rather than introducing a flag per screen.

| Feature | Default status | Runtime key / env suffix; other controls | Providers / implementation |
| --- | --- | --- | --- |
| Authentication, accounts, onboarding | Enabled, configured provider required | No general auth feature flag; `AUTH_PROVIDER`, `OVERLAY_PROVIDER_AUTH` | WorkOS default; Better Auth; generic OIDC. `none` is not production authentication |
| SSO | Enabled, provider dependent | `sso` / `SSO`; `OVERLAY_CAPABILITY_SSO` | WorkOS or Better Auth/OIDC; Better Auth connection presets include Google Workspace, Auth0, Entra ID, generic OIDC |
| Chats and native agent conversations | Enabled | `chat` / `CHAT` | Overlay orchestration, Convex persistence/realtime, model gateway |
| Work: tasks, lists, board, timeline | Enabled | `work` / `WORK` | Overlay, Convex |
| Files, uploads, notes, saved outputs | Enabled | `files` / `FILES`; notes have no dedicated switch | Convex metadata, Cloudflare R2 or S3-compatible object storage |
| Memories and knowledge ingestion | Enabled | `memory` / `MEMORY`, `knowledge` / `KNOWLEDGE`; UI `knowledge` | Convex and configured embeddings; Memories in Settings, no separate Knowledge navigation |
| Semantic retrieval | Enabled | `vectorSearch` / `VECTOR_SEARCH`; `VECTOR_SEARCH_ENABLED` | Convex vector search; Vercel AI Gateway or OpenAI embeddings |
| Scheduled automations | Enabled | `automations` / `AUTOMATIONS`; `AUTOMATIONS_ENABLED`; UI `automations` | Overlay workflows, Convex scheduler; external target still requires external runtime release |
| Extensions and integrations | Enabled | `integrations` / `INTEGRATIONS`; UI `extensions` | Composio default or Executor; linked-account and tool permissions still apply |
| Skills | Enabled | `skills` / `SKILLS`; `SKILLS_ENABLED` | Overlay/Convex skill records and tool pipeline |
| MCP server connections | Enabled | `mcpServers` / `MCP_SERVERS`; `MCP_SERVERS_ENABLED` | MCP protocol and configured servers |
| Connected apps / Overlay MCP access | Implemented, unchanged | No dedicated external-agent release flag; OAuth grants/access policy | Overlay MCP server for outside clients; separate from hosting an external agent runtime |
| Browser automation | Enabled in config, provider dependent | `browserUse` / `BROWSER_USE` | Browser-use; native computer browser tools are a separate computer surface |
| Sandbox tool capability | Enabled in config | `sandboxes` / `SANDBOXES` | Not a substitute for `COMPUTERS` or external cloud flags; runtime/provider wiring is described below |
| Web search | Enabled, credentials required | `webSearch` / `WEB_SEARCH` | Elo gateway (Tavily/Parallel search paths), `ELO_API_KEY` |
| Models, routing, native provider connections | Enabled | `modelRouting` / `MODEL_ROUTING`; `LLM_GATEWAY`, `OVERLAY_PROVIDER_MODELS` | OpenRouter default, Vercel AI Gateway, OpenAI, Anthropic, Groq; allowlists and billing still apply |
| Voice transcription | Enabled, hosted paid access required | UI `voiceTranscription`; no dedicated runtime switch | Groq hosted transcription; local on-device transcription is a separate client path |
| Image/video generation | Implemented, model/tool/entitlement gated | No dedicated runtime flag; tool grants and configured gateway | Configured media models and output services; not disabled by external runtime release |
| Workspaces, teams, invitations | Enabled in app | UI `workspaces`; collaboration rollout below | Convex, Overlay membership/authorization |
| Collaborative chats, channels, sharing | Enabled in app | UI `collaborativeChats`, `channels`, `resourceSharing` | Convex; `OVERLAY_COLLABORATION_ROLLOUT` and workspace rollout stage (`dogfood`, `invited`, `general`; default `general`) |
| Billing, limits, usage accounting | Enabled, credentials required | `billing` / `BILLING`; `OVERLAY_CAPABILITY_BILLING`, `BILLING_ENABLED` | Stripe or `none`; authoritative Free/Paid entitlements, not release flag targeting |
| Outbound webhooks | Disabled by default, opt-in | `webhooks` / `WEBHOOKS`; `WEBHOOKS_ENABLED` | Overlay delivery/Convex. Not Stripe inbound webhooks |
| API keys | Disabled by default, opt-in | `apiKeys` / `API_KEYS`; `API_KEYS_ENABLED` | Overlay/Convex key management |
| Multi-tenant capability flag | Disabled by default | `multiTenant` / `MULTI_TENANT`; `MULTI_TENANT_ENABLED` | Distinct from enabled workspace membership/isolation; do not toggle to enable Agents |
| Analytics | Enabled, credentials required | `analytics` / `ANALYTICS` | PostHog or `none` |
| Error reporting | Enabled, credentials required | `errorReporting` / `ERROR_REPORTING` | Sentry or `none` |
| OpenTelemetry export | Disabled, opt-in outbound connection | `openTelemetry` / `OPEN_TELEMETRY` | Customer OTLP collector; exporter configuration required |
| API rate limits | Enabled | `apiDefaultRateLimit` / `API_DEFAULT_RATE_LIMIT` | Convex default; Redis, memory or `none` |
| Mutation audit and origin guard | Enabled | `apiMutationAudit` / `API_MUTATION_AUDIT`, `apiMutationOriginGuard` / `API_MUTATION_ORIGIN_GUARD` | Overlay audit, browser-origin validation; not runtime release flags |
| Lifecycle events | Enabled | `lifecycleEvents` / `LIFECYCLE_EVENTS` | Overlay event bus and consumers |
| Transactional email | Flag enabled, provider defaults to `none` | `transactionalEmail` / `TRANSACTIONAL_EMAIL`; `OVERLAY_EMAIL_PROVIDER` / `EMAIL_PROVIDER` | Resend, Amazon SES or SMTP; sender/provider credentials required |
| Database, realtime and background jobs | Implemented, required | `database.provider=convex`; no product release flag | Convex only; Better Auth's database is separate |
| Secret/key storage | Implemented, provider-specific | `OVERLAY_PROVIDER_SECRETS`, `llm.keySource` | Environment credentials, WorkOS Vault; AWS Secrets Manager for BYOK. No plaintext secrets in config |

The app-shell defaults for workspaces/collaboration/channels/agents/sharing are off in the reusable package but explicitly **on** in this app's `src/overlay.config.ts`. Turning them off is not part of this launch.

## Provider selectors and limitations

Provider names accepted by the schema are **not** proof of a working adapter. Defaults live in the runtime config; actual selection is enforced in [bootstrap.ts](src/server/bootstrap.ts) and individual service factories.

| Area | Selector | Implemented selection / limitation |
| --- | --- | --- |
| Auth | `AUTH_PROVIDER`, `OVERLAY_PROVIDER_AUTH` | `workos`, `better-auth`, `oidc`, `none`; Better Auth needs its own database and SSO/access-policy config |
| Storage | `OVERLAY_PROVIDER_OBJECT_STORAGE`, `storage.provider` | `r2`, `s3`, `none` |
| Models | `OVERLAY_PROVIDER_MODELS`, `LLM_GATEWAY` | `openrouter`, `ai-gateway`, `openai`, `anthropic`, `groq`, `none`; gateway models and credential stores remain independent of external harness accounts |
| Embeddings | `OVERLAY_PROVIDER_EMBEDDINGS` | `ai-gateway`, `openai`; `azure-openai` is schema-only, not implemented by the factory |
| Vector search | `OVERLAY_PROVIDER_VECTOR_SEARCH` | `convex`, `none`; `pgvector` and `pinecone` are rejected as unimplemented |
| Integrations | `OVERLAY_PROVIDER_INTEGRATIONS` | `composio`, `executor`, `none`; schema value `mcp` is not selected by the integration factory (use MCP server connections separately) |
| Persistent native computers | `OVERLAY_COMPUTER_PROVIDER` | `box` only today, backed by Boat at `boat.dev` (formerly Box); E2B is not wired into native computer selection |
| External managed sandboxes | `OVERLAY_MANAGED_SANDBOX_PROVIDER` | `box` (Boat) or `e2b`; `BOAT_API_KEY`/legacy `BOX_API_KEY` or `E2B_API_KEY` and template configuration |
| General sandbox declaration | `OVERLAY_PROVIDER_SANDBOX` | Do not confuse with the two runtime selectors above. `vercel`/`daytona` are retired inert compatibility values; `local-firecracker` is a schema option, not a connected runtime |
| Browser/search declarations | `OVERLAY_PROVIDER_BROWSER`, `OVERLAY_PROVIDER_WEB_SEARCH` | Current paths use Browser-use/Elo. Schema alternatives are not a promise that switching the selector wires up another implementation |
| Observability | `OVERLAY_PROVIDER_ANALYTICS`, `OVERLAY_PROVIDER_ERROR_REPORTING` | `posthog`/`none`, `sentry`/`none` respectively |
| Email | `OVERLAY_EMAIL_PROVIDER`, `EMAIL_PROVIDER` | `resend`, `ses`, `smtp`, `none` |
| Secrets | `OVERLAY_PROVIDER_SECRETS` | BYOK factory selects AWS for `aws-secrets-manager`, otherwise WorkOS Vault; `vault` is not a HashiCorp adapter. Environment model keys are separately selected by `llm.keySource`; `config` key source is reserved/rejected |
| Rate limiting | `OVERLAY_PROVIDER_RATE_LIMIT` | `convex`, `redis`, `memory`, `none`; Redis needs URL or REST credentials |

For opt-in features outside external runtimes, enable the listed runtime/capability controls together, configure the implemented provider, redeploy and test the affected API and UI on an isolated preview. Do not assume a default-off flag is launch-approved simply because its code exists. Keep this inventory and the feature's living documentation updated when it is released.
