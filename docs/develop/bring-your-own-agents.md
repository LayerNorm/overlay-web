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

Phases 0 and 1 are implemented. The connected-agent repository now includes command
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

The host executable currently accepts a manually provisioned environment-scoped credential
through a named environment variable. Phase 3 replaces that bootstrap step with short-lived
enrollment, proof of possession, browser approval, and canonical control-plane routes; Phase 2
does not create shadow endpoints. Conformance tests cover start, stream, approval, cancel,
duplicate delivery, out-of-order rejection, server outage, host restart, reconnect/resume, and
an actual ACP subprocess exchange.

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
  directory with restrictive permissions. Unacknowledged output is written before upload;
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

Route services read these flags before selecting a database repository, so Convex and
PostgreSQL have identical disabled behavior. Enabling a dependent feature does not implicitly
enable its prerequisite: Overlay Cloud requires all three, and remote runs require the first
two. These are server policy switches, not client assertions; bootstrap may expose only the
resulting authorized capability.

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

Protocol version 1 transports `start`, `prompt`, approval response, `cancel`, `reconnect`, and
`shutdown` commands and normalizes session start, text checkpoints, actions, approval requests,
artifacts, completion, failure, and cancellation events. The HTTP client treats route URLs as
control-plane configuration; `/api/v1/agent-environments/**` route implementation remains Phase
3. Credentials are bearer-scoped by that future control plane and are never included in logs.

## Provider-neutral persistence contract

`AgentEnvironment`, `AgentBinding`, `AgentRunCommand`, `AgentRemoteSession`,
`AgentApprovalRequest`, and `AgentSandboxLease` are separate domain records. Agent identity,
harness adapter, environment, sandbox provider, and protocol adapter must not collapse into
one enum. The existing `AgentRun` state machine remains lifecycle authority and gains a
`remote` runner plus optional environment, binding, and remote-session references.

Both repositories must authorize workspace ownership on every operation, claim commands with
a lease atomically, apply contiguous event checkpoints exactly once, make revocation win over
new claims, preserve cancellation as terminal, and cascade workspace/account deletion.
