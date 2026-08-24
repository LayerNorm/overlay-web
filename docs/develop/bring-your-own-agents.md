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
