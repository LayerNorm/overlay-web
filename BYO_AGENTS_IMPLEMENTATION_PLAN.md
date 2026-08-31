# Bring your own agents implementation plan

> Status: active implementation plan.
>
> Sequence: implement this as Overlay's final feature with full Convex and
> PostgreSQL parity. After it stabilizes, freeze new Convex product work and
> begin the separate PostgreSQL cutover.
>
> Last reviewed: 2026-08-24.
>
> Completion legend: ✅ means the phase implementation has landed. Live
> cross-provider, production-like, and release evidence remains governed by
> each phase's exit gate and the Phase 9 release matrix.


## Decision and boundary

Before the PostgreSQL cutover, implement one final product feature against both
Convex and PostgreSQL: users can connect agents running on their computer, a
customer VPS, a hosted agent service, or an Overlay-provisioned sandbox. These
agents participate through the same workspace principal, `@mention`, durable
run, approval, billing, cancellation, artifact, and transcript contracts as
Overlay-native agents.

This feature must not become a remote-desktop product. Its first generally
available scope is agent conversations and supervised work:

- Local and VPS environments through one portable Overlay Agent Host.
- Overlay Cloud environments, with Vercel Sandbox as the managed default and
  Daytona retained behind the same internal sandbox contract.
- Agent Client Protocol as the primary coding-agent adapter.
- Bounded adapters for eve and harnesses that do not implement ACP.
- `@mention` invocation, streaming output, approvals and elicitation,
  cancellation, reconnect, session resume, artifacts, audit, and billing.

Do not include unrestricted terminal access, a general file browser, port
forwarding, browser DevTools, arbitrary home-directory access, or cross-workspace
agent commerce in the first release. The architecture may accommodate those
later, but they are different security and product surfaces.

## Architectural invariants

1. Overlay owns the canonical workspace identity, `AgentRun`, transcript,
   approval, budget, policy, and audit records. A host or harness owns only its
   private execution state and remote session.
2. Agent identity, harness adapter, execution environment, sandbox provider,
   and protocol adapter remain separate concepts. Do not keep expanding the
   current `WorkspaceAgentDefinition.harness` enum until it represents all five.
3. Remote agent output projects into the existing assistant message and
   `conversationMessages`; it does not create a second transcript.
4. The existing `AgentRun` state machine remains the lifecycle authority. Add a
   remote runner rather than creating a parallel run model.
5. The host makes outbound connections only. Local and customer environments
   never require an inbound public port.
6. Durable commands and acknowledged cursors are authoritative. WebSockets may
   lower latency later but may not be required for correctness.
7. Every domain repository, route, deletion path, billing path, and test suite
   ships for Convex and PostgreSQL in the same phase. Postgres mode must never
   silently call Convex.
8. The network protocol and sandbox contract are Overlay-owned, versioned, and
   provider-neutral. Third-party SDKs are adapters, not public product APIs.
9. Remote agent text, tool state, and artifacts are untrusted input. Persist
   user-visible results and concise action summaries, not private chain of
   thought.
10. The implementation must be removable from Convex without changing its
    public contracts when PostgreSQL later becomes canonical.

## Target execution flow

```text
human @mentions connected agent
              |
              v
Overlay authorizes room + agent + initiator
              |
              v
transaction: AgentRun + placeholder + billing reservation + command
              |
              v
Agent Host long-polls commands over authenticated outbound HTTP
              |
              v
ACP / eve / native adapter runs the remote agent
              |
              v
host SQLite outbox -> batched, sequenced event upload
              |
              v
transaction: apply event + advance cursor + update message/run/approval
              |
       +------+------+
       v             v
Convex query      Postgres durable event
subscription     + notifier/long poll
       |             |
       +------v------+
           same room UI
```

The host event envelope must include at least `protocolVersion`, `eventId`,
`environmentId`, `runId`, `sourceSequence`, `type`, `occurredAt`, and a
versioned payload. Each batch must be contiguous. Applying its projections and
advancing the last acknowledged sequence happens in one database transaction.
A repeated sequence is acknowledged without reapplying it; a gap is rejected
with the next expected sequence.

Do not permanently store one database event per token. Batch text checkpoints,
project them into the existing message, and retain durable lifecycle and audit
events. The host keeps unacknowledged frames in a local SQLite outbox so a
server or network failure cannot lose accepted output.

## ✅ Phase 0: lock the contract and release boundary

Deliverables:

- Add a living implementation design for user-owned agents and register it in
  `AGENTS.md` when implementation starts.
- Freeze the first-release scope above and write the threat model, data
  classification, retention rules, offline policy, and supported-platform
  matrix.
- Define three server-side rollout flags: connected-agent control plane, remote
  agent runs, and Overlay Cloud environments. Flags must behave identically for
  both database providers.
- Record the public API resources and protocol-version policy before creating
  tables or UI.

Exit gate: the control-plane contract, trust boundaries, first adapters, and
non-goals are approved; no unresolved decision changes the schema or auth
model.

## ✅ Phase 1: provider-neutral domain and persistence

Create provider-neutral contracts for:

- `AgentEnvironment`: local, VPS, Overlay Cloud, or externally hosted.
- `AgentBinding`: joins a workspace agent identity to one environment and one
  protocol adapter.
- `AgentRunCommand`: start, cancel, approval response, reconnect, or shutdown.
- `AgentRemoteSession`: remote session ID, command cursor, event cursor,
  capability snapshot, and lifecycle timestamps.
- `AgentApprovalRequest`: immutable request and resolution audit history.
- `AgentSandboxLease`: provider reference, reservation, runtime, usage, and
  cleanup state for managed environments.

Extend `AgentRun` with a remote runner and explicit environment, binding, and
remote-session references. Retain the human initiator separately from the agent
principal that authors messages and performs delegated actions.

Implement the corresponding Convex tables/functions and PostgreSQL migration,
schema, repositories, indexes, cascades, account/workspace deletion, cleanup,
and reconciliation. Add the repositories to the application data context and
the route/capability parity matrix.

Exit gate: one shared repository contract suite passes against real Convex and
real PostgreSQL for creation, authorization, command claiming, ordered event
application, duplicate delivery, cancellation races, revocation, and deletion.

## ✅ Phase 2: Overlay Agent Host and protocol conformance

Implementation status: complete in `@layernorm/overlay-agent-bridge-protocol` and
`@layernorm/overlay-agent-host`. Phase 3 layers enrollment and server routes onto these
packages without changing the Phase 2 execution protocol. The live PostgreSQL
contract must still be rerun whenever the contract database is available.

Build a portable `overlay-agent-host` executable and an original, versioned,
Zod-validated bridge protocol. The host must provide:

- Device key generation and secure local storage.
- Capability and adapter discovery.
- Explicit filesystem grants: multiple selected roots or deliberate
  `all_user_files`; never infer whole-home access from an omitted grant.
- Outbound command polling with bounded long polls and reconnect backoff.
- A SQLite command-deduplication store and event outbox.
- Batching, sequence acknowledgement, gap recovery, and backpressure.
- Adapter lifecycle: discover, start, prompt, approve, cancel, resume, and stop.
- Redacted structured logs and a self-diagnostic command.

Implement a fake adapter first, then the ACP client adapter. Use official ACP
types or generate from the official schema. Shellular is useful prior art for a
portable host, typed protocol, ACP adapters, device approval, reconnect, and a
local SQLite cache; do not copy its AGPL-only protocol into an Apache-licensed
Overlay package.

Exit gate: a protocol conformance test proves start, streaming, approval,
cancel, host crash, server crash, duplicate frames, out-of-order frames,
reconnect, and resume without duplicate user-visible effects.

## ✅ Phase 3: secure enrollment and environment management

Implementation status: complete. Browser management, one-command host enrollment, Ed25519 proof
of possession, short-lived method-scoped credentials, replay protection, explicit project-root
approval, command/event limits, revocation, audit, and Convex/PostgreSQL parity are implemented.

Add canonical `/api/v1/agent-environments/**` routes for enrollment-session
creation, enrollment, browser approval, listing, heartbeat, command polling,
batched event upload, capability refresh, and revocation.

Enrollment should work as follows:

1. The signed-in user chooses a workspace and creates a short-lived,
   single-use enrollment code.
2. The UI presents one copyable command, such as
   `npx @layernorm/overlay-agent-host connect <code>`.
3. The host generates a device key pair, redeems the code, and appears as
   pending with its name, operating system, host version, and capabilities.
4. The browser shows a short verification phrase; the user approves the
   environment and grants explicit project roots.
5. The host proves possession of its key and receives only short-lived,
   environment-scoped service credentials.

Store public keys and secret hashes, never reusable enrollment secrets. Bind
tokens to the exact workspace, environment, audience, methods, expiry, and
nonce. Revocation must stop new commands immediately and make existing leases
expire safely. Record every enrollment, approval, scope change, and revocation
in the workspace audit trail.

Exit gate: cross-workspace access, expired codes, replay, forged events,
revoked hosts, unauthorized roots, and command/event size abuse are rejected
identically in Convex and PostgreSQL.

## ✅ Phase 4: first native vertical slice

Implementation status: complete. The Convex staging path has passed an authenticated browser
smoke from enrollment through a local Codex run, persisted transcript, terminal run, command
acknowledgement, and revocation. The equivalent live PostgreSQL browser run remains release
evidence for Phase 9.

Route a connected workspace agent through the existing
`workspace-agent-invocation` path:

1. Resolve the `@mention`, room membership, agent policy, binding, and online
   or offline state.
2. Atomically create the remote `AgentRun`, assistant placeholder, billing
   reservation, and start command.
3. Let the host claim the command idempotently and bind its remote session.
4. Map normalized ACP updates into the one existing assistant message's
   structured parts and existing conversation events.
5. Finalize the run, message, usage, and command exactly once.

For interactive mentions, queue an offline environment for a short, explicit
window and show `Waiting for <environment>` with Cancel and Retry. Do not imply
that an offline machine is actively working.

Ship Codex and one second ACP-compatible harness as the first compatibility
targets. Adding another ACP agent should be a manifest and conformance-test
change, not new Overlay conversation logic.

Exit gate: in both provider modes, a human can `@mention` the connected agent,
watch stable Markdown and action updates, refresh or open a second tab, and see
one correct final transcript and one terminal run.

## ✅ Phase 5: complete supervised-work semantics

Implementation status: complete. The full approval, recovery, restart, and artifact-cleanup
browser matrix remains release evidence for Phase 9.

Add:

- Permission requests and structured elicitation mapped to Overlay's approval
  UI and immutable approval records.
- Cancellation from the room and command propagation to the harness.
- Remote-session resume and a deliberate `start fresh` option.
- Artifact upload through scoped, short-lived object-store URLs with type,
  size, checksum, malware, tenancy, and retention validation.
- Tool/action summaries, plan updates, diffs, and terminal summaries as
  structured message parts.
- Timeout, lease expiry, host disappearance, retry classification, and manual
  recovery.

The approving human must be authorized at resolution time. The response must
match an outstanding option and pending remote request; the host must not be
able to forge an approval. The agent principal is the actor for delegated work,
while the summoning human remains the initiator and billing attribution source.

Exit gate: approval, rejection, elicitation, cancellation, timeout, browser
refresh, app restart, host restart, and artifact cleanup pass end to end with no
stuck reservations or duplicate side effects.

## ✅ Phase 6: provider-neutral managed sandboxes

Implementation status: complete. Production-like Vercel and Daytona lifecycle evidence remains
required before broad release.

Define `@overlay/sandbox-runtime` before adding another managed provider. Its
contract must cover lifecycle, command streaming, files, environment variables,
ports, snapshots or persistence, network policy, credential brokering, timeout,
usage, capability flags, and a raw-provider diagnostic escape hatch.

Implement:

- A Vercel Sandbox adapter using the official SDK as the default Overlay Cloud
  backend.
- A Daytona adapter by moving the existing Daytona runner behind the same
  contract.
- The same Agent Host image and bridge protocol inside either sandbox, so
  managed and user-owned environments do not create two agent execution paths.

The ordinary setup choice is `Overlay Cloud`, not `Vercel versus Daytona`.
Provider selection belongs in advanced or operator settings. A multi-provider
sandbox SDK may be used experimentally behind this interface, but it must not
own Overlay's billing, lifecycle, security policy, or public API.

Exit gate: the sandbox conformance suite passes for Vercel and Daytona;
provision, reconnect, snapshot or restore, idle stop, hard timeout, cancellation,
network policy, and cleanup are proven in a production-like environment.

### Overlay Cloud model authentication policy

- Offer Overlay-funded models as the lowest-friction default. Overlay owns those credentials,
  meters their use, and applies the workspace's billing and policy controls.
- Make API keys/BYOK the first authentication path for a user's own provider account. Broker each
  secret into the sandbox at execution time; never persist it in an image, snapshot, transcript,
  command, or agent-visible configuration file.
- Add browser or device login separately only where that provider officially supports a remote or
  headless flow. Do not generalize an unofficial login flow across providers.
- Never copy, mount, archive, upload, or otherwise transplant a user's local Codex, Claude, or
  equivalent authentication directory into an Overlay Cloud sandbox.

## ✅ Phase 7: VPS and non-ACP adapters

Implementation status: complete. Publishing the npm packages and Agent Host image, plus a clean
VPS conformance run against staging, remain release evidence rather than code-completeness gates.

Package the same host for foreground CLI, background service, Docker, and a
documented systemd deployment. A VPS needs only outbound HTTPS and persistent
storage for the host state and harness sessions.

Add a bounded eve adapter through eve's supported session/streaming interface.
For a user-hosted eve service, prefer running the Agent Host beside eve rather
than exposing eve directly to the public internet. Add native Hermes, OpenClaw,
or other adapters only when ACP is unavailable and after they pass the same
host conformance suite. Treat A2A as a later interoperability adapter; MCP
continues to represent tools and resources, not the agent execution lifecycle.

Exit gate: a clean VPS installation can enroll, survive host and Overlay
restarts, run a mentioned agent, request approval, cancel, resume, and upgrade
without opening an inbound port.

## ✅ Phase 8: billing, policy, observability, and operations

Implementation status: complete. BYOK host calls are excluded from Overlay model usage, while
Overlay Cloud creates an independent `sandbox` reservation against `agent:<agentId>` before the
start command and settles metered CPU, provisioned memory, and egress through the existing
idempotent usage ledger. Environment, concurrency, hard-runtime, event-rate, artifact-byte,
idle-time, egress, and monthly-spend limits are enforced through shared policy values and atomic
provider operations. Correlated run/event audits and maintenance alerts cover the operational
matrix below. A durable per-reservation settlement marker makes provider-read and post-ledger crash
retries automatic in both provider modes. Live invoice reconciliation remains Phase 9 release evidence.

Use the existing workspace billing and programmatic spend subject
`agent:<agentId>`:

- Local or customer-VPS execution does not incur Overlay sandbox compute. Bill
  only Overlay-provided models, tools, storage, or control-plane entitlements.
- BYOK model calls executed entirely on the user's host do not become Overlay
  model usage.
- Overlay Cloud reserves the maximum allowed sandbox lease and any Overlay model
  usage before dispatch, then settles actual provider usage exactly once.
- Enforce plan limits for environments, concurrent runs, runtime, event rate,
  artifact bytes, idle duration, and monthly spend.

Add correlated observability for workspace, agent, environment, run, command,
remote session, sandbox provider reference, reservation, and event cursor.
Alerts must cover offline fleets, cursor gaps, stuck commands, lease expiry,
approval age, settlement failures, cleanup failures, and provider spend.

Exit gate: retry and crash tests prove exact-once reservation settlement;
provider invoices reconcile to Overlay usage records; every run has a complete,
redacted audit trail.

## Phase 9: dual-provider release and production rollout

Implementation status: release machinery is implemented, including fail-closed workspace stages,
independent incident switches, cross-platform host CI, bounded load rehearsals, route/provider
inventory enforcement, and schema-version rollback checks. The phase remains open until the live
Convex and PostgreSQL browser matrices, managed-provider conformance, invoice reconciliation,
and production soak satisfy the exit gate; do not mark it ✅ from local tests.

Release rehearsal on 2026-08-25 established the current runtime baseline at staging commit
`c0e56958e`:

- The complete release gate, runtime configuration suite, TypeScript check, isomorphic-boundary
  check, bounded load rehearsal, and deterministic sandbox conformance suite passed.
- Convex dev `different-caiman-77` and `staging.getoverlay.io` serve the allowlisted internal
  workspace. Authenticated Chrome QA loaded the environment inventory without fresh console errors.
- GitHub Actions run `32828571507` passed the host protocol, tests, and typecheck on macOS 14,
  Ubuntu 24.04, and Windows Server 2022.
- PostgreSQL schema 68 passed both live connected-agent contracts in deployment
  `dpl_42BEd1gxBJ3UTRbWoVYH5mfTTfDb`. Runtime deployment
  `dpl_FLjfy6pSMRx5vpmQJ5wgShyxkswR` passed the strengthened signed-out browser matrix across the
  public shell, sign-in, chat, and environment settings with zero Convex connections and zero
  JavaScript/runtime errors. Fresh Chrome tabs loaded both provider surfaces without console errors,
  and unauthenticated enrollment rejection matches Convex at HTTP 401.

Phase 9 remains open. The authenticated PostgreSQL browser matrix, a fresh end-to-end enrollment
and room invocation matrix, live Vercel and Daytona sandbox conformance, provider invoice
reconciliation, artifact-retention soak, and production Convex rollout still require evidence.

Before broad release:

- Run unit, protocol, repository, route, authorization, billing, deletion,
  migration, and chaos tests.
- Run host tests on supported macOS, Linux, and Windows versions.
- Run authenticated browser QA for enrollment, agent creation, room invocation,
  streaming, approval, cancellation, resume, offline behavior, revocation, and
  managed sandbox creation.
- Run the full scenario once with Convex and once with PostgreSQL. The
  PostgreSQL run must prove that the browser and server make zero Convex calls.
- Load-test commands, event ingestion, room fan-out, and reconnect storms.
- Rehearse schema rollback, host protocol compatibility, sandbox cleanup, and
  incident kill switches.

Release through workspace allowlists, then internal dogfood, invited users, and
general availability. Do not maintain separate product semantics for Convex and
PostgreSQL.

Exit gate: both providers pass the same release evidence, the feature runs
stably in production on Convex, and the PostgreSQL deployment has a current,
repeatable live parity result.

## Phase 10: freeze dual-provider product work and begin PostgreSQL cutover

After the user-owned-agent release stabilizes, stop adding new product domains
to Convex. Treat the shared contracts and dual-provider conformance suite as the
behavioral baseline for the PostgreSQL migration described earlier in this
document.

The cutover remains a separate project with its own data migration, realtime,
load, backup, rollback, and production gates. Only after PostgreSQL has served
production successfully through the rollback window should the Convex tables,
functions, subscriptions, capability branches, deployment lane, and duplicate
tests be removed.

## Recommended pull-request sequence

Keep every pull request deployable behind disabled server-side flags:

1. Contracts, state machines, schemas, repositories, and dual-provider tests.
2. Host protocol, fake adapter, SQLite outbox, and conformance harness.
3. Enrollment/auth APIs, environment UI, revocation, and audit.
4. ACP local-agent vertical slice through `@mention` and `AgentRun`.
5. Approvals, cancellation, resume, artifacts, and recovery.
6. Sandbox runtime plus Vercel and Daytona adapters.
7. VPS packaging plus eve and selected non-ACP adapters.
8. Billing, quotas, observability, abuse controls, and reconciliation.
9. Cross-platform, live-provider, browser, load, and chaos evidence.
10. Staged rollout and the PostgreSQL-migration readiness checkpoint.

## Current implementation source map

- [Workspace agent contracts](packages/overlay-workspace-contracts/src/types.ts)
- [Agent run state machine](src/shared/agents/agent-run.ts)
- [Workspace agent invocation](src/server/agents/workspace-agent-invocation.ts)
- [Workspace agent durable lifecycle](src/server/agents/workspace-agent-turn-lifecycle.ts)
- [Application data capabilities](src/server/app-data/capabilities.ts)
- [Provider parity matrix](src/server/app-data/parity-matrix.ts)
- [Application data repositories](src/server/app-data/repositories.ts)
- [PostgreSQL schema](src/server/database/postgres/schema.ts)
- [Convex schema](convex/schema.ts)
- [Current Daytona sandbox runner](src/server/app-api/v1/daytona/run/sandbox-runner.ts)
- [API source of truth](docs/develop/api-source-of-truth.mdx)
- [Application architecture](docs/develop/architecture.mdx)
- [Automation durability](docs/develop/automation-durability-and-visual-editor.md)
- [Local agent conversation formats](docs/develop/traversing-agent-conversations.md)
- [Worktree and staging QA](docs/develop/worktree-staging-qa.mdx)

## External references

- [Agent Client Protocol](https://agentclientprotocol.com/get-started/introduction)
- [Vercel Sandbox](https://vercel.com/docs/sandbox)
- [Shellular host packages](https://github.com/shellular-org/packages)
- [Shellular relay server](https://github.com/shellular-org/server)
