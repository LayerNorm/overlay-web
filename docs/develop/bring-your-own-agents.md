# Bring Your Own Agents

This is the living design for agents connected from user-owned computers, customer VPSs,
hosted agent services, and Overlay-managed sandboxes. The rollout is provider-neutral:
Convex and PostgreSQL must expose identical behavior, and PostgreSQL mode must never fall
back to Convex.

See [Bring Your Own Agents architecture](./bring-your-own-agents-architecture.md) for diagrams of
the environment topology, protocol layers, enrollment, Agent Host loop, ACP adapters, durable run
flow, memory, and package boundaries.

## Release boundary

The first release supports agent conversations and supervised work through one outbound-only
Overlay Agent Host. ACP is the primary coding-agent adapter; bounded eve and native adapters
may normalize into the same protocol. Environments are `local`, `vps`, `overlay_cloud`, or
`external`. Overlay Cloud uses Vercel Sandbox by default, with Daytona behind the same private
sandbox interface.

The release includes `@mention` invocation, durable runs and commands, streamed transcript
projection, approval/elicitation, cancellation, reconnect/resume, artifacts, audit, policy,
and billing. It explicitly excludes remote desktop, unrestricted terminals, general file
browsing, port forwarding, browser DevTools, implicit home-directory access, and
cross-workspace agent commerce.

An environment is an execution boundary such as one computer, VPS, container, or managed
sandbox. It is not an agent and it is not a folder: one environment may expose multiple
adapters and agent bindings. Filesystem authority is a separate explicit grant. A host may be
granted several selected roots, or the user may deliberately choose `all_user_files`, which
inherits only the files available to the host's OS account. The host never converts an omitted
grant into home-directory access. Managed sandboxes may default to one agent for operational
simplicity, but neither the protocol nor persistence schema enforces that cardinality.

## Implementation status

Phases 0 through 8 are implemented. Phase 9 release controls and repeatable local evidence are
implemented, but Phase 9 is not complete until the live Convex and PostgreSQL browser matrices,
managed-provider conformance, and production stability gates are recorded.
Overlay Cloud activation remains
gated on publishing the Agent Host image and passing live Vercel conformance in the target
project; Phase 7 release remains gated on publishing the host packages and passing a clean VPS
conformance run against staging. The connected-agent repository now includes command
acknowledgement, immutable approval resolution, managed-lease lifecycle, binding/session scope
validation, and a shared positive and negative provider contract. The contract passes against
an in-process Convex runtime; the PostgreSQL suite uses a migrated real database and is the
required live gate whenever the local or remote contract database is available.

Phase 2 is implemented in two public AGPL-3.0-only workspace packages:

- `@layernorm/overlay-agent-bridge-protocol` owns protocol version 1, strict Zod command/event schemas,
  payload and batch limits, contiguous sequence validation, acknowledgements, capabilities,
  and explicit filesystem grants.
- `@layernorm/overlay-agent-host` owns Ed25519 device keys, environment- and workspace-scoped SQLite command
  deduplication and durable event outbox state, bounded outbound HTTP polling, reconnect backoff, backpressure, diagnostics,
  redacted JSON logs, adapter discovery/lifecycle, the deterministic fake adapter, and the
  official ACP TypeScript SDK adapter. A pristine host state store adopts the server's command
  stream position on first delivery (a previous host incarnation may have consumed earlier
  sequences); once a cursor exists, out-of-order commands still fail closed as replays.

The host executable supports `connect <code> --server <origin>`. The agent editor emits a single
harness-specific command with `--adapter <id> --run`; the same command works on a local computer,
VPS, or customer sandbox. It creates or reuses an Ed25519 device key, displays the same short
phrase shown in Overlay, waits for browser approval, stores
the resulting short-lived credential in a mode-0600 connection file, signs every control-plane
request, and rotates credentials before expiry. A named environment-variable credential remains
available for operational compatibility. Conformance tests cover start, stream, approval, cancel,
duplicate delivery, out-of-order rejection, fresh-state stream adoption, server outage, host
restart, reconnect/resume, and an actual ACP subprocess exchange.

Phase 3 enrollment begins in Agents > New agent > Bring your own agent. The user selects a harness
and either reuses an approved environment, creates one outbound connection for a local computer,
VPS, or customer sandbox, or provisions Overlay Cloud. Settings > Environments remains the fleet
administration surface for pending approval recovery, health, scope changes, listing, and
revocation. Workspace owners and admins can create a ten-minute, single-use enrollment code and
approve a pending host with one or more absolute project roots. Public host routes
never accept browser-session authority. Initial issuance requires the one-time challenge plus an
Ed25519 signature; subsequent calls require an opaque 15-minute credential and a signature over
the exact method, pathname and query, body hash, timestamp, request nonce, and token hash.

Canonical routes are `/api/v1/agent-environments`, `/enrollment-sessions`, `/enroll`, and the
environment-scoped `approve`, `roots`, `revoke`, `credentials`, `credentials/refresh`, `heartbeat`,
`capabilities`, `commands`, command acknowledgement, and `events` subresources. Enrollment-code,
challenge, credential, and request-nonce consumption is atomic in Convex and PostgreSQL. Only
hashes of enrollment codes, proof challenges, opaque credentials, and request nonces are stored.
The Convex credential validator derives its method allowlist from the canonical workspace
contract so artifact upload authority and future method additions cannot drift by provider.
Revocation cancels unclaimed work, revokes active credentials, disables bindings, and moves live
managed leases to immediate cleanup.

Phase 4 routes an agent with an enabled binding through the existing room mention path. Mention,
room membership, agent participation, binding, environment scope, and the host's advertised ACP
adapter are revalidated before dispatch. PostgreSQL and Convex each use one provider transaction
to create the existing assistant placeholder, a `remote` AgentRun, its remote-session record, and
one start command. The payer allowance check happens before that transaction; a non-null billing
reservation is released if the transaction cannot commit and its idempotency key is the
message-agent invocation nonce. User-owned ACP model execution is not charged as Overlay model
usage.

Host event batches advance the remote cursor and project full Markdown checkpoints plus stable
action parts into that one assistant message in the same transaction. Session start binds the
harness session ID; completion, failure, and cancellation settle the session, run, message,
command, token metrics, and existing conversation event exactly once. Duplicate terminal batches
return the existing acknowledgement and never append a second transcript row. Interactive offline
mentions have a two-minute claim window and visibly render `Waiting for <environment>` with Cancel
and Retry; expired leases cannot be claimed.

Agent DMs and channels use the same per-message memory policy for hosted and connected agents.
Memory defaults on only when an agent participates in the room; the composer switch disables both
recall and extraction for that turn. An invoked agent receives bounded workspace memory, hybrid
retrieval, the participant roster, and recent role-tagged room history. ACP transports this context
inside a delimited, size-bounded prompt envelope so existing protocol-v1 hosts remain compatible.
Only an agent-triggering human message is eligible for human-owned extraction; ordinary human-only
room chatter is never silently ingested. A completed agent reply may produce conservative,
agent-owned memories for explicit decisions, verified outcomes, stable project facts, and reusable
constraints. Suggestions, private reasoning, secrets, and unverified action claims are excluded.
Both Convex and PostgreSQL validate the exact workspace, room, message, author kind, and memory
owner before scheduling extraction; duplicate deliveries remain idempotent.
Extraction prompts may include bounded prior messages by that same human or exact agent principal,
but never messages authored by other room participants. Room-wide context is reserved for the
invoked agent turn and is not implicitly forwarded to the separate memory-extraction model.
The PostgreSQL memory and memory-index `user_id` columns are legacy-named opaque owner identifiers,
not human-user foreign keys. Human account deletion removes human-owned rows explicitly; agent
rows remain attributed to the stable `agent-memory:<agentId>` principal within their workspace.
The database also keeps a user-delete compatibility trigger so older runtimes retain the prior
cascade behavior during a rolling upgrade or rollback.

Bindings are managed through `/api/v1/agent-bindings` and remain separate from agent identity.
The Agents directory derives its connected-harness label from the active binding rather than the
agent's historical model ID, so agents created before the BYO editor still display their actual
runtime.
The agent editor starts with an explicit `Overlay agent` versus `Bring your own agent` choice.
That choice is rendered only after a workspace-scoped connected-agent request succeeds; deployments
with the global flag disabled and workspaces outside the active rollout stage stay on the normal
Overlay-agent editor instead of exposing a form that can never submit.
Overlay-only instructions, model selection, and tool grants never appear in the BYO branch. The
BYO branch selects the harness first, filters approved environments by advertised ACP adapter, and
records an explicitly granted default working directory. Creating an environment stays inside the
same dialog and returns directly to the binding step after phrase and root approval. A failed
binding retry edits the already-durable agent identity rather than creating a duplicate. The host
ships data-only manifests for Codex (`@agentclientprotocol/codex-acp@1.7.0`) and Claude Code
(`@agentclientprotocol/claude-agent-acp@0.70.0`). Hermes 0.20.6 or newer is a third built-in target
through the official `hermes acp` stdio server. It uses the unchanged ACP lifecycle for session
creation/loading, streamed message and tool updates, permissions, cancellation, and authentication;
the host does not translate Hermes through a private protocol. Adding another ACP target extends the
manifest and conformance fixtures, not conversation orchestration. The built-in user-owned adapter
IDs live in
`@overlay/workspace-contracts`; they are deliberately separate from the managed-sandbox adapter
allowlist so enabling a local or VPS adapter never makes Overlay Cloud eligible.
PostgreSQL migration 0066 repairs older databases whose recorded migration history omitted the
nullable conversation-message edit-history column required by the shared transcript writer.

Phase 5 completes the supervised-work contract. ACP permission requests and form elicitations
become immutable, workspace-scoped request records and structured message parts. Resolution
rechecks active human membership and room participation, accepts only an outstanding option or a
schema-valid form response, and emits one idempotent response command; a host cannot resolve its
own request. Room controls propagate cancellation to the harness and expose recovery as explicit
`Resume` and `Start fresh` actions backed by the persisted remote session and original start
payload. The agent principal remains the message/action actor while the summoning human remains
the initiator and billing source.

ACP plans, file diffs, terminal references/summaries, tool actions, and Markdown checkpoints are
stored as structured parts on the existing assistant row. Artifact intents create five-minute,
run/environment/workspace-scoped object-store uploads capped at 25 MiB. Completion verifies exact
type and size, recomputes SHA-256, rejects EICAR and executable signatures, and makes only clean
artifacts linkable through a participant-authorized short-lived download redirect. Artifact rows
expire after 30 days and cleanup deletes the object before tombstoning metadata. PostgreSQL runs
cleanup in its maintenance worker; Convex schedules an internal-secret BFF cleanup bridge because
object-store credentials remain on the application host. Convex deployments therefore require
`OVERLAY_BFF_URL` and the same `INTERNAL_API_SECRET` as the corresponding web deployment.

The terminal run event is authoritative for visible tool lifecycle. Completion, failure, or
cancellation closes any remote action or attached terminal that the harness left in a running
state. The renderer applies the same rule to older persisted transcripts so finished work never
keeps an in-progress shimmer after refresh.

Remote leases are extended only by accepted contiguous events. Convex supervises expired or
disappeared hosts every minute; the PostgreSQL background worker performs the same bounded sweep.
Both project a recoverable state, cancel outstanding commands, close pending requests, and settle
or reconcile the original billing reservation exactly once. PostgreSQL migration 0067 adds
request kinds and artifact metadata. The shared provider contract now covers artifact tenancy,
validation state, retention cleanup, and idempotent tombstones.

The managed-sandbox boundary is `@overlay/sandbox-runtime`. Its contract covers
lifecycle and reconnect, streamed and cancellable commands, files, process environment, ports,
snapshots and persistence, network policy, broker-owned credential references, idle and hard
timeouts, usage, capability flags, and an explicitly operator-only raw SDK handle. Vercel Sandbox
uses the official `@vercel/sandbox` SDK and is the default `Overlay Cloud` backend. Daytona uses
the official `@daytona/sdk` adapter, and the legacy `/api/v1/daytona/run` execution and artifact
path now performs command and file operations through the same runtime contract.

`POST /api/v1/agent-environments/managed` is the provider-neutral provisioning resource. The
ordinary agent-creation choice is labeled `Overlay Cloud`; provider selection is available only to
operators through `OVERLAY_MANAGED_SANDBOX_PROVIDER` and defaults to `vercel`. Vercel creation is
pinned to `OVERLAY_VERCEL_SANDBOX_REGION` (default `iad1`) so the configured unit rates match a
known region. Both providers boot
the image configured by `OVERLAY_AGENT_HOST_IMAGE`. That image contains the same
`@layernorm/overlay-agent-host` executable used on user-owned machines and invokes the same one-time
enrollment, Ed25519 proof, browser approval, short-lived credentials, polling, and ACP bridge.
Managed hosts enroll as `overlay_cloud` and default their explicit approval root to `/workspace`.
Provisioning receives the selected managed ACP adapter and starts only that pinned harness manifest;
the browser still performs the normal explicit root approval. No provider receives a privileged
alternate host credential.

Credential bindings contain an opaque broker reference, placeholder environment variable, and
allowed domains. Vercel translates resolved header material into network-policy transforms;
Daytona maps the reference to an existing organization Secret and relies on its egress-time
substitution. Provider SDK objects and references are never public response fields. Deterministic
conformance runs for both provider identities on every package test; live provider conformance is
opt-in with `OVERLAY_SANDBOX_LIVE_CONFORMANCE=1` and remains the release gate for provision,
reconnect, provider-supported snapshot/restore or persistent stop/resume, command
timeout/cancellation, network enforcement, usage, and cleanup. Daytona snapshot creation remains
experimental and timed out in live verification, so the Daytona adapter currently advertises
persistence and reconnect but not snapshots. It must not claim the capability until the live test
passes reliably.

Overlay Cloud model access follows a fixed priority. Overlay-funded models are the default and
lowest-friction path. BYOK/API keys are the first customer-owned authentication path and are
brokered at execution time rather than embedded in images, snapshots, commands, or transcripts.
Provider-specific browser or device login may be added only when that provider officially supports
a remote or headless flow. Overlay never copies, mounts, uploads, or imports a user's local Codex,
Claude, or equivalent authentication directory into a managed sandbox.

Phase 7 makes `@layernorm/overlay-agent-host` and `@layernorm/overlay-agent-bridge-protocol` publishable packages and
requires Node.js 24. The first production package line is `0.1.0`; Hermes support was released in
the lockstep `0.2.0` package line under the shorter legacy names. The product-qualified public
package names begin with lockstep `0.3.0`; the current PATH-safe release line is lockstep `0.3.4`. The application copies an exact
`npx --yes --package node@24 --package @layernorm/overlay-agent-host@0.3.4 overlay-agent-host ...`
command rather than following npm `latest` or inheriting an unsupported system Node runtime. The host and
protocol packages release together, the host depends on the exact protocol version, and the npm
release workflow publishes compiled ESM plus declarations for both packages with provenance after
the compatibility, package-content, and clean Node.js installation gates. Published package entry
points never require TypeScript stripping or a consumer-supplied loader. The release workflow leaves
the legacy `@layernorm/agent-host` and `@layernorm/agent-bridge-protocol` releases installable and
deprecates them with migration guidance only after the `0.3.0` packages publish successfully.
Enrollment atomically saves a mode-0600 restart configuration beside the private credential state.
The same executable runs as a foreground CLI, a per-user macOS LaunchAgent, a restartable systemd
service, or the default process in the Agent Host container. The macOS service command uses the
pinned Node 24 and host package versions, survives Terminal closure, restarts after login or
process failure, and persists a sanitized executable search path so adapters installed under
user-level locations such as `~/.local/bin` remain available to `launchd`. The documented VPS and Docker shapes expose no
inbound port and persist SQLite/device state across restarts and upgrades. The hardened systemd
unit runs under a dedicated OS account; operators must align `ReadWritePaths` with the exact roots
approved in Overlay.

The bounded Eve adapter uses only the public `eve/client` session API and durable event stream. It
is pinned to Eve 0.44.4 while Eve is preview. Overlay projects visible message checkpoints,
actions, usage, terminal state, and pending input requests, never private reasoning. Approval and
elicitation replies are checked against the outstanding Eve request, and the host persists the Eve
session ID, stream cursor, visible text accumulator, and usage accumulator after every event. A
reconnect without that cursor fails closed and requires the deliberate `start fresh` path. The Eve
service should run beside the host on loopback or a private network; Overlay does not require it to
be publicly reachable. Eve connection
authorization (`authorization.required`) is not bridged by the current host contract, so the
adapter fails that run closed instead of leaving an OAuth pause unobservable. Use static or
app-scoped Eve connection auth until a dedicated authorization capability is added.
Hermes uses its official ACP server. OpenClaw and other native adapters remain ineligible unless ACP
is unavailable and the unchanged host conformance suite passes.

Phase 8 uses one entitlement-derived policy for both persistence providers. Environment redemption
rechecks the enrollment-time environment ceiling atomically; remote dispatch atomically enforces
workspace concurrency and one active run per managed environment. Hard run deadlines cap lease
renewal. Event uploads use per-environment minute windows, and artifact creation reserves workspace
bytes before issuing an object-store URL. Free, paid, and max plans also bound idle time, sandbox
egress, and managed runtime; the existing billing ledger remains the monthly-spend gate.

Host-side BYOK model tokens remain observable but never become Overlay model usage. A local or VPS
environment has no sandbox reservation. Overlay Cloud creates a distinct pre-dispatch `sandbox`
reservation under `agent:<agentId>` in addition to any explicitly Overlay-funded model reservation.
Actual Vercel usage settles the SDK's cumulative vCPU-milliseconds, provisioned-memory wall time,
decimal-GB outbound transfer, and per-creation charge where a run creates its own sandbox; Daytona settles
its resource-time dimensions. The reservation ledger is the exact-once boundary, and an unavailable
provider or failed usage read moves the reservation to reconciliation instead of guessing at a
charge. Reservations assume every allocated vCPU is active for the full allowed runtime, include
the plan egress ceiling, and add `OVERLAY_VERCEL_SANDBOX_RESERVATION_BUFFER_PERCENT` (25% by
default). `OVERLAY_SANDBOX_MAX_PROVIDER_COST_USD_PER_RUN` rejects an estimated run above USD 15 by
default before provider work starts. The four `OVERLAY_VERCEL_SANDBOX_*_USD_*` rate variables must
be updated when the selected region or provider contract changes. Persistent Vercel sandboxes retain
one latest snapshot and delete the evicted snapshot to bound storage growth. A durable settlement marker is created atomically with each managed run and is cleared only
after the idempotent usage ledger and lease usage record both succeed. PostgreSQL maintenance retries
pending markers directly; the Convex scheduler calls the internal BFF reconciliation route so
provider credentials never move into Convex. `OVERLAY_SANDBOX_PROVIDER_SPEND_ALERT_USD` controls the
per-run provider-spend warning threshold and defaults to USD 10. Vercel account-level spend alerts
and limits remain mandatory because provider storage and aggregate monthly overages are not visible
in a single run's SDK counters.

Every dispatch and accepted cursor checkpoint writes a redacted audit record correlated by
workspace, agent, environment, run, command, remote session, provider reference, reservation, and
event cursor. Immediate alerts cover cursor gaps, settlement and artifact-cleanup failure, and high
provider spend. The one-minute supervisor also reports offline environments, expired leases, stuck
commands, aged approvals, and failed sandbox cleanup. PostgreSQL maintenance prunes event-rate
windows; Convex performs the same cleanup through its scheduled mutation.

Phase 9 adds a fail-closed workspace rollout independent of the three incident kill switches.
The PostgreSQL browser smoke treats console errors as failures in addition to page errors and
network/WebSocket activity. Convex subscription hooks must live in provider-gated bridge components;
passing `"skip"` to `useQuery` still requires a mounted `ConvexProvider` and is therefore not a
valid PostgreSQL fallback. The signed-out variant ignores only the browser's generic 401/403 resource
messages; authenticated QA and all JavaScript/runtime console errors remain fail-closed.
`OVERLAY_CONNECTED_AGENTS_ROLLOUT_STAGE` progresses through `off`, `internal`, `invited`, and
`general`. Internal workspaces come from `OVERLAY_CONNECTED_AGENTS_INTERNAL_WORKSPACE_IDS`; the
invited stage additionally includes `OVERLAY_CONNECTED_AGENTS_INVITED_WORKSPACE_IDS`. A workspace
outside the active stage cannot create or manage environments and cannot dispatch a new remote run.
Existing host credentials remain governed by the global control-plane kill switch so operators can
choose between stopping new tenant dispatch and immediately stopping the entire fleet.

The repeatable local release gate is `npm run check:byo-agents:release`. It covers unit, protocol,
host crash/reconnect, Convex repository, authorization, billing, route inventory, migration-version,
no-Convex PostgreSQL bootstrap, bounded command/event/fan-out load, managed sandbox, and cleanup
tests. `npm run check:byo-agents:release:postgres` runs the migrated PostgreSQL provider contract
against the configured remote contract database. Host compatibility runs in GitHub Actions on
macOS 14, Ubuntu 24.04, and Windows Server 2022. These automated checks do not replace authenticated
browser QA, live provider conformance, invoice reconciliation, or production soak evidence.

The 2026-08-25 release rehearsal at staging runtime commit `c0e56958e` passed that gate and the full
configuration, TypeScript, and isomorphic-boundary checks. Convex dev `different-caiman-77` served
the allowlisted internal workspace through `staging.getoverlay.io`; authenticated Chrome QA loaded
its environment inventory without fresh console errors. GitHub Actions run `32828571507` passed on
macOS 14, Ubuntu 24.04, and Windows Server 2022. PostgreSQL deployment
`dpl_42BEd1gxBJ3UTRbWoVYH5mfTTfDb` migrated to schema 68 and passed both connected-agent provider
contracts. Runtime deployment `dpl_FLjfy6pSMRx5vpmQJ5wgShyxkswR` passed the strengthened signed-out
browser matrix across the public shell, sign-in, chat, and environment settings with zero Convex
connections and zero JavaScript/runtime errors; fresh Chrome tabs loaded both provider surfaces
without console errors. The unauthenticated enrollment boundary matched Convex at HTTP 401. This is
a release baseline, not Phase 9 completion.

The PostgreSQL release deployment must enable the provider-neutral workspace, agent, room, and
conversation routes as well as the connected-agent control plane. A signed-out 401/403 matrix is
insufficient: authenticated QA must create its Personal workspace, load Environments, and
exercise the same enrollment-to-mention flow without any Convex request.

Deployment `dpl_HsV4gn8EmABm75xATvxbTkeg1uiE` passed the authenticated PostgreSQL shell matrix for
the Personal workspace, Agent Environments, Agents, and Chat. The browser resource inventory
contained no Convex URL, emitted no runtime error, and the server no-Convex bootstrap and release
safety suites passed. The same rehearsal found and repaired a stale route-support gate that had
incorrectly hidden provider-neutral workspace collaboration routes in PostgreSQL mode.

Artifact release evidence includes an accelerated bounded-batch soak: more than two cleanup pages
of expired objects must drain exactly once, tombstones must remain idempotent, and unexpired objects
must survive. This deterministic rehearsal complements rather than replaces the calendar-time
production retention observation.

Live sandbox conformance uses the strictest portable lifecycle constraint shared by the supported
providers. In particular, Vercel snapshot fixtures request a one-day expiry because the live API
rejects shorter expirations. Resume the original persistent sandbox before deleting its snapshot,
then delete the snapshot explicitly during cleanup.

The 2026-08-25 live conformance run passed for both Vercel Sandbox and Daytona. Phase 9 remains open
until the fresh enrollment-to-mention matrix, provider-invoice reconciliation, calendar-time
artifact-retention observation, and matching production Convex rollout and stability evidence are
complete.

## Trust boundaries and threat model

- Overlay owns workspace identity, authorization, `AgentRun`, commands, approvals, budgets,
  transcript projections, audit, and artifact policy. A host owns only private harness state,
  its SQLite outbox, and remote session identifiers.
- Hosts make outbound HTTPS connections only. Enrollment credentials and subsequent service
  credentials are environment- and workspace-scoped, short-lived, revocable, method-bound,
  and never grant general user-session authority.
- Host text, tool state, metadata, and artifacts are hostile input. Validate versions, sizes,
  sequences, payload schemas, checksums, and authorization before projection. Never persist
  private chain of thought; retain user-visible results and concise action summaries.
- Primary threats are enrollment-code theft/replay, device-key theft, cross-workspace ID
  substitution, forged or reordered events, approval forgery, command replay, malicious
  artifacts, path traversal, secret leakage, resource exhaustion, stale-host execution, and
  revoked-host continuation. Durable idempotency, contiguous cursors, proof of possession,
  explicit root grants, scoped upload URLs, quotas, redaction, revocation, and lease expiry
  are mandatory mitigations.
- The local SQLite database and Ed25519 private key are created under an explicit state
  directory with restrictive permissions. POSIX hosts enforce `0o600` secret files and a
  `0o700` key directory; Windows hosts rely on the current user's inherited profile ACL because
  Node exposes Windows ACLs only as synthetic POSIX mode bits. Unacknowledged output is written before upload;
  acknowledged frames are removed while the per-run sequence remains monotonic across restarts.
- Selected roots authorize command working directories and the roots advertised to ACP. They
  do not claim to sandbox an arbitrary child process at the operating-system layer. Strict file
  isolation requires a restricted OS account, container, VM, or managed sandbox; the explicit
  `all_user_files` choice accurately represents an unrestricted local harness.
- A human initiator and the agent principal are distinct. Authorization and billing remain
  attributable to the initiator; messages and delegated actions are authored by the agent.

## Data classification and retention

| Data | Classification | Retention |
| --- | --- | --- |
| Public device key, host/capability metadata | workspace-confidential | Until environment deletion plus the normal deletion grace period |
| Credential hashes, nonces, enrollment records | restricted security data | Active lifetime plus 30 days of replay/audit evidence; never log raw secrets |
| Commands, lifecycle events, approvals, audit | workspace-confidential; approvals are immutable audit | Workspace retention policy; security audit minimum 90 days where policy permits |
| Transcript projections and artifacts | customer content | Existing conversation/artifact retention and deletion policy |
| Host private state and unacknowledged SQLite outbox | customer-controlled local data | Until acknowledgement; terminal session metadata may remain until host cleanup |
| Redacted operational telemetry | internal operational data | Existing metrics/log retention policy |

Workspace/account erasure cascades through environments, bindings, sessions, commands,
approvals, and leases. Object-store cleanup is reconciled asynchronously. Security evidence
required by law may be tombstoned and access-restricted rather than silently orphaned.

## Offline policy

An offline environment never appears to be working. The environment list derives its displayed
health from the most recent heartbeat: an `online` row becomes effectively `offline` after 45
seconds without a heartbeat, and the settings UI refreshes every 15 seconds while environments
exist. Interactive mentions may remain queued
for a short, explicitly displayed window; the UI must show `Waiting for <environment>` with
Cancel and Retry. Commands are durable and claim-once. Revocation prevents new claims
immediately; active credentials expire and leases terminate safely. Reconnect resumes from
acknowledged command/event cursors. Duplicate sequences are acknowledged without reapplying;
gaps are rejected with the next expected sequence.

## Supported platforms

| Host target | First-release support | Packaging |
| --- | --- | --- |
| macOS 14+ (Apple Silicon and x64) | Supported | npm executable plus per-user LaunchAgent service commands |
| Linux x64/arm64 (current Ubuntu/Debian/RHEL-family) | Supported | npm executable and Docker; systemd follows host hardening |
| Windows 11 / Server 2022 x64 | Supported | npm executable; Windows service packaging may follow |
| Overlay Cloud Linux sandbox | Deferred and unavailable in product UI | Same host image and bridge protocol after the managed-environment release gate |
| Mobile OS, browser-only runtimes, end-of-life desktop OSs | Not supported | None |

## Rollout flags

The server-side runtime config has four independent, default-off flags:

1. `features.connectedAgentControlPlane` gates enrollment and environment management.
2. `features.remoteAgentRuns` gates command dispatch and remote `AgentRun` execution.
3. `features.connectedAgentArtifacts` gates agent artifact upload, completion, and download.
4. `features.overlayCloudEnvironments` gates managed-environment provisioning.

The environment-variable forms are `OVERLAY_FEATURE_CONNECTED_AGENT_CONTROL_PLANE`,
`OVERLAY_FEATURE_REMOTE_AGENT_RUNS`, `OVERLAY_FEATURE_CONNECTED_AGENT_ARTIFACTS`, and
`OVERLAY_FEATURE_OVERLAY_CLOUD_ENVIRONMENTS`.
They are positive, server-side switches: missing, false, or malformed values resolve to disabled.
This makes each switch an environment-controlled, fail-closed incident control. Overlay Cloud's
switch remains false for the production workspace rollout, and the agent editor does not expose a
managed-environment choice while that release is deferred.

Broad release also requires `OVERLAY_CONNECTED_AGENTS_ROLLOUT_STAGE` plus the internal and invited
workspace allowlists described above. The rollout defaults to `off`; turning on a feature flag alone
does not make any workspace eligible.

The first production activation is intentionally narrow:

- publish and independently install-smoke the exact Agent Host and bridge-protocol versions;
- set `OVERLAY_FEATURE_CONNECTED_AGENT_CONTROL_PLANE=1` and
  `OVERLAY_FEATURE_REMOTE_AGENT_RUNS=1` in production;
- keep `OVERLAY_FEATURE_CONNECTED_AGENT_ARTIFACTS=0` and
  `OVERLAY_FEATURE_OVERLAY_CLOUD_ENVIRONMENTS=0`;
- set the rollout stage to `internal` or `invited` and populate only the corresponding exact
  workspace IDs; and
- verify the public capability response, an ineligible workspace's hidden BYO editor, and a full
  eligible-workspace enroll, approve, bind, invoke, stream, cancel, reconnect, revoke path before
  widening the allowlist.

Changing a rollout variable requires a new production deployment so the immutable web runtime reads
the approved values. Roll back by setting the rollout stage to `off`; use either global feature flag
as the incident kill switch when the entire control plane or all new remote dispatch must stop.

Route services read these flags before selecting a database repository, so Convex and
PostgreSQL have identical disabled behavior. Enabling a dependent feature does not implicitly
enable its prerequisite: Overlay Cloud requires all three, and remote runs require the first
two. These are server policy switches, not client assertions; bootstrap may expose only the
resulting authorized capability.

Connected-agent artifacts remain disabled in staging and production until uploads are quarantined,
scanned in full by a production malware engine, validated by content magic, and served only as safe
attachments after an immutable clean verdict. The existing checksum, size, tenancy, retention, and
cleanup controls remain implemented but are not a substitute for that release gate.

Managed provisioning additionally requires `OVERLAY_AGENT_HOST_IMAGE`. Vercel deployments use a
Vercel Container Registry reference; Daytona may use the equivalent OCI image in its configured
registry. `VERCEL_OIDC_TOKEN` is preferred on Vercel. An operator running elsewhere may instead
provide `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`; Daytona uses its existing API
URL and key configuration.

The dormant managed API and provider adapters remain implemented so the future release can reuse
the same host protocol. Restoring the UI additionally requires the image, conformance, credential
brokering, egress, billing, cleanup, security-review, and server-authoritative readiness gates
tracked in this document's managed-environment release-gate section.

## Public resources and protocol policy

Canonical resources live under `/api/v1/agent-environments` (enrollment sessions,
enrollment/approval, environments, heartbeat, command polling, event batches, capabilities,
and revocation), `/api/v1/agent-bindings`, and the existing conversation run/approval routes.
Managed leases are a subresource of environments and are not provider-branded. Secrets,
provider references, raw harness state, and private chain of thought are never public fields.

The Overlay bridge protocol uses an integer `protocolVersion`, starting at `1`. Every event
includes `protocolVersion`, `eventId`, `environmentId`, `runId`, `sourceSequence`, `type`,
`occurredAt`, and a versioned payload. Batches must be contiguous. Projection and cursor
advance are one transaction. Servers support the current and immediately preceding version
during a documented host-upgrade window; unknown major versions fail closed with a structured
upgrade error. Additive optional fields are backward compatible, while semantic or required
field changes increment the version. WebSockets may optimize latency but durable HTTP polling
and acknowledged cursors remain authoritative.

Protocol version 1 transports `start`, `prompt`, permission and elicitation responses, `cancel`,
`reconnect`, and `shutdown` commands and normalizes session start, text checkpoints, actions,
permission/elicitation requests, plans, diffs, terminal summaries, validated artifacts,
completion, failure, and cancellation events. The HTTP client treats route URLs as
control-plane configuration; `/api/v1/agent-environments/**` is the canonical Phase 3 control
plane. Credentials are bearer-scoped by that control plane and are never included in logs.

## Provider-neutral persistence contract

`AgentEnvironment`, `AgentBinding`, `AgentRunCommand`, `AgentRemoteSession`,
`AgentApprovalRequest`, and `AgentSandboxLease` are separate domain records. Agent identity,
harness adapter, environment, sandbox provider, and protocol adapter must not collapse into
one enum. The existing `AgentRun` state machine remains lifecycle authority and gains a
`remote` runner plus optional environment, binding, and remote-session references.

Both repositories must authorize workspace ownership on every operation, claim commands with
a lease atomically, apply contiguous event checkpoints exactly once, make revocation win over
new claims, preserve cancellation as terminal, and cascade workspace/account deletion.
The triggering human message and the remote agent run deliberately have distinct turn IDs;
dispatch binds them through the validated user-message ID, conversation, actor, and run row.
