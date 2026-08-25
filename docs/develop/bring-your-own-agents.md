# Bring Your Own Agents

This is the living design for agents connected from user-owned computers, customer VPSs,
hosted agent services, and Overlay-managed sandboxes. The rollout is provider-neutral:
Convex and PostgreSQL must expose identical behavior, and PostgreSQL mode must never fall
back to Convex.

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

Phase 2 is implemented in two Apache-licensed workspace packages:

- `@overlay/agent-bridge-protocol` owns protocol version 1, strict Zod command/event schemas,
  payload and batch limits, contiguous sequence validation, acknowledgements, capabilities,
  and explicit filesystem grants.
- `@overlay/agent-host` owns Ed25519 device keys, SQLite command deduplication and durable event
  outbox state, bounded outbound HTTP polling, reconnect backoff, backpressure, diagnostics,
  redacted JSON logs, adapter discovery/lifecycle, the deterministic fake adapter, and the
  official ACP TypeScript SDK adapter.

The host executable supports `connect <code> --server <origin>`. It creates or reuses an Ed25519
device key, displays the same short phrase shown in Settings, waits for browser approval, stores
the resulting short-lived credential in a mode-0600 connection file, signs every control-plane
request, and rotates credentials before expiry. A named environment-variable credential remains
available for operational compatibility. Conformance tests cover start, stream, approval, cancel,
duplicate delivery, out-of-order rejection, server outage, host restart, reconnect/resume, and
an actual ACP subprocess exchange.

Phase 3 browser management lives in Settings > Agent environments. Workspace owners and admins
can create a ten-minute, single-use enrollment code, approve a pending host with one or more
absolute project roots, change its scope, list environments, and revoke them. Public host routes
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

Bindings are managed through `/api/v1/agent-bindings` and remain separate from agent identity.
The agent editor exposes approved environments, their advertised ACP adapters, and an explicitly
granted working directory. The host ships data-only manifests for Codex
(`@agentclientprotocol/codex-acp`) and Claude Code (`@agentclientprotocol/claude-agent-acp`); adding
another ACP target extends the manifest and conformance fixtures, not conversation orchestration.
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

Remote leases are extended only by accepted contiguous events. Convex supervises expired or
disappeared hosts every minute; the PostgreSQL background worker performs the same bounded sweep.
Both project a recoverable state, cancel outstanding commands, close pending requests, and settle
or reconcile the original billing reservation exactly once. PostgreSQL migration 0067 adds
request kinds and artifact metadata. The shared provider contract now covers artifact tenancy,
validation state, retention cleanup, and idempotent tombstones.

Phase 6 adds `@overlay/sandbox-runtime` as the only managed-sandbox boundary. Its contract covers
lifecycle and reconnect, streamed and cancellable commands, files, process environment, ports,
snapshots and persistence, network policy, broker-owned credential references, idle and hard
timeouts, usage, capability flags, and an explicitly operator-only raw SDK handle. Vercel Sandbox
uses the official `@vercel/sandbox` SDK and is the default `Overlay Cloud` backend. Daytona uses
the official `@daytona/sdk` adapter, and the legacy `/api/v1/daytona/run` execution and artifact
path now performs command and file operations through the same runtime contract.

`POST /api/v1/agent-environments/managed` is the provider-neutral provisioning resource. The
ordinary Settings choice is labeled `Overlay Cloud`; provider selection is available only to
operators through `OVERLAY_MANAGED_SANDBOX_PROVIDER` and defaults to `vercel`. Both providers boot
the image configured by `OVERLAY_AGENT_HOST_IMAGE`. That image contains the same
`@overlay/agent-host` executable used on user-owned machines and invokes the same one-time
enrollment, Ed25519 proof, browser approval, short-lived credentials, polling, and ACP bridge.
Managed hosts enroll as `overlay_cloud` and default their explicit approval root to `/workspace`.
No provider receives a privileged alternate host credential.

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

Phase 7 makes `@overlay/agent-host` and `@overlay/agent-bridge-protocol` publishable packages and
requires Node.js 24. The same executable runs as a foreground CLI, a restartable systemd service,
or the default process in the Agent Host container. The documented VPS and Docker shapes expose no
inbound port and persist SQLite/device state across restarts and upgrades. The hardened systemd
unit runs under a dedicated OS account; operators must align `ReadWritePaths` with the exact roots
approved in Overlay.

The bounded Eve adapter uses only the public `eve/client` session API and durable event stream. It
is pinned to Eve 0.44.4 while Eve is preview. Overlay projects visible message checkpoints,
actions, usage, terminal state, and pending input requests, never private reasoning. Approval and
elicitation replies are checked against the outstanding Eve request, and the host persists the Eve
session ID plus stream cursor after every event. A reconnect without that cursor fails closed and
requires the deliberate `start fresh` path. The Eve service should run beside the host on loopback
or a private network; Overlay does not require it to be publicly reachable. Hermes, OpenClaw, and
other native adapters remain ineligible unless ACP is unavailable and the unchanged host
conformance suite passes.

Phase 8 uses one entitlement-derived policy for both persistence providers. Environment redemption
rechecks the enrollment-time environment ceiling atomically; remote dispatch atomically enforces
workspace concurrency and one active run per managed environment. Hard run deadlines cap lease
renewal. Event uploads use per-environment minute windows, and artifact creation reserves workspace
bytes before issuing an object-store URL. Free, paid, and max plans also bound idle time, sandbox
egress, and managed runtime; the existing billing ledger remains the monthly-spend gate.

Host-side BYOK model tokens remain observable but never become Overlay model usage. A local or VPS
environment has no sandbox reservation. Overlay Cloud creates a distinct pre-dispatch `sandbox`
reservation under `agent:<agentId>` in addition to any explicitly Overlay-funded model reservation.
Actual Vercel usage settles active CPU, provisioned memory, and outbound transfer; Daytona settles
its resource-time dimensions. The reservation ledger is the exact-once boundary, and an unavailable
provider or failed usage read moves the reservation to reconciliation instead of guessing at a
charge. A durable settlement marker is created atomically with each managed run and is cleared only
after the idempotent usage ledger and lease usage record both succeed. PostgreSQL maintenance retries
pending markers directly; the Convex scheduler calls the internal BFF reconciliation route so
provider credentials never move into Convex. `OVERLAY_SANDBOX_PROVIDER_SPEND_ALERT_USD` controls the per-run provider-spend warning
threshold and defaults to USD 10.

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
a release baseline, not Phase 9 completion: the
authenticated PostgreSQL browser matrix, fresh enrollment and room invocation matrix, live Vercel
and Daytona conformance, invoice reconciliation, artifact-retention soak, and production rollout
remain outstanding.

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

An offline environment never appears to be working. Interactive mentions may remain queued
for a short, explicitly displayed window; the UI must show `Waiting for <environment>` with
Cancel and Retry. Commands are durable and claim-once. Revocation prevents new claims
immediately; active credentials expire and leases terminate safely. Reconnect resumes from
acknowledged command/event cursors. Duplicate sequences are acknowledged without reapplying;
gaps are rejected with the next expected sequence.

## Supported platforms

| Host target | First-release support | Packaging |
| --- | --- | --- |
| macOS 14+ (Apple Silicon and x64) | Supported | npm executable; foreground first |
| Linux x64/arm64 (current Ubuntu/Debian/RHEL-family) | Supported | npm executable and Docker; systemd follows host hardening |
| Windows 11 / Server 2022 x64 | Supported | npm executable; Windows service packaging may follow |
| Overlay Cloud Linux sandbox | Supported | Same host image and bridge protocol |
| Mobile OS, browser-only runtimes, end-of-life desktop OSs | Not supported | None |

## Rollout flags

The server-side runtime config has three independent, default-off flags:

1. `features.connectedAgentControlPlane` gates enrollment and environment management.
2. `features.remoteAgentRuns` gates command dispatch and remote `AgentRun` execution.
3. `features.overlayCloudEnvironments` gates managed-environment provisioning.

The environment-variable forms are `OVERLAY_FEATURE_CONNECTED_AGENT_CONTROL_PLANE`,
`OVERLAY_FEATURE_REMOTE_AGENT_RUNS`, and `OVERLAY_FEATURE_OVERLAY_CLOUD_ENVIRONMENTS`.

Broad release also requires `OVERLAY_CONNECTED_AGENTS_ROLLOUT_STAGE` plus the internal and invited
workspace allowlists described above. The rollout defaults to `off`; turning on a feature flag alone
does not make any workspace eligible.

Route services read these flags before selecting a database repository, so Convex and
PostgreSQL have identical disabled behavior. Enabling a dependent feature does not implicitly
enable its prerequisite: Overlay Cloud requires all three, and remote runs require the first
two. These are server policy switches, not client assertions; bootstrap may expose only the
resulting authorized capability.

Managed provisioning additionally requires `OVERLAY_AGENT_HOST_IMAGE`. Vercel deployments use a
Vercel Container Registry reference; Daytona may use the equivalent OCI image in its configured
registry. `VERCEL_OIDC_TOKEN` is preferred on Vercel. An operator running elsewhere may instead
provide `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`; Daytona uses its existing API
URL and key configuration.

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
