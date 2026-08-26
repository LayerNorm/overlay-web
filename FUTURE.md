# Future architecture

> Status: deferred architecture direction, not an active migration plan.
>
> Last reviewed: 2026-08-23.
>
> Overlay production and staging continue to use Convex. Do not change the
> database provider, deploy eve, or remove an existing provider because of this
> document. Start the work below only when the maintainer explicitly activates
> the migration after the remaining product work is complete.

## Purpose

This document records the intended long-term direction for Overlay's data,
realtime, agent-execution, and deployment architecture. It exists so that the
decision can be revisited without repeating the research or mistaking a future
direction for current implementation.

The direction is:

1. Make PostgreSQL Overlay's eventual canonical application database.
2. Keep Convex as the production bridge until PostgreSQL passes explicit
   parity, reliability, migration, and rollback gates.
3. Replace Convex Realtime with an Overlay-owned durable event and realtime
   layer over PostgreSQL rather than treating `LISTEN/NOTIFY` as durable state.
4. Evaluate eve as a bounded agent-execution harness for Personal Work mode,
   automations, and eve-native remote agents. eve must not own Overlay's
   workspace, collaboration, billing, identity, or canonical transcript data.
5. Remove the dual-provider implementation only after production has run
   successfully on PostgreSQL and the rollback window has closed.

## Product thesis

Overlay is intended to become the coordination layer over work performed by
humans, digital agents, and eventually physical agents and devices.

The long-term system must support:

- Humans and agents as first-class workspace principals.
- Conversations, channels, threads, tasks, files, projects, and knowledge
  shared across those principals.
- Autonomous work that remains governed by human direction, approvals,
  budgets, policy, and auditability.
- Interaction between independently operated workspaces and agents.
- Managed SaaS, private-cloud, on-premises, and customer-controlled deployments.
- Portable execution across hosted sandboxes, customer infrastructure, local
  machines, and remote agent harnesses.

The durable product moat is not a specific database subscription API. It is the
combination of identity, scoped delegation, reliable execution, collaboration,
approvals, economic authority, interoperability, and audit trails.

## PostgreSQL as the eventual canonical database

### Decision

PostgreSQL should become the long-term source of truth for Overlay application
data. This is a destination, not approval for an immediate cutover.

The current Convex implementation is not a mistake. Convex remains a strong
hosted backend and is particularly productive for a small team. The reason to
consolidate on PostgreSQL is Overlay's deployment and product strategy, not a
claim that PostgreSQL is universally better.

### Why PostgreSQL fits Overlay

- PostgreSQL is a standard dependency for SaaS, private cloud, on-premises, and
  enterprise infrastructure. Customers already have operational practices for
  RDS, Aurora, Cloud SQL, Azure Database for PostgreSQL, Supabase, Neon, and
  self-managed PostgreSQL.
- It keeps the application portable across managed providers and customer-owned
  infrastructure through a normal connection string and standard SQL.
- Relational transactions fit Overlay's future control-plane data: principals,
  memberships, capabilities, approvals, contracts, budgets, spending authority,
  asset ownership, and audit records.
- PostgreSQL, pgvector, the Workflow PostgreSQL world, durable jobs, and the
  application data layer can share standard infrastructure while retaining
  separate schemas, credentials, backup policies, and lifecycles where needed.
- The repository has already implemented a substantial PostgreSQL surface:
  repositories, migrations, workers, automation and webhook durability,
  collaboration records, agent runs, billing, files, projects, and account
  deletion.
- A single canonical provider will be easier for coding agents and humans than
  two valid implementations with different semantics and deployment lanes.

### What consolidation eventually removes

The present dual-provider architecture carries a permanent tax:

- Two schemas and migration models.
- Two repository implementations for many domains.
- Provider capability and route matrices.
- Provider-specific browser synchronization paths.
- Duplicate contract, deletion, billing, and lifecycle testing.
- Independent Vercel and Convex deployments that can drift.
- Ambiguity for coding agents about which path is authoritative.

Keep the repository and service interfaces. Once PostgreSQL is proven in
production, remove the duplicate Convex implementation and provider branches.
Merely routing production to PostgreSQL while maintaining permanent parity does
not achieve the maintainability goal.

### What PostgreSQL does not provide automatically

Moving to PostgreSQL makes Overlay responsible for infrastructure that Convex
currently packages together:

- Schema migrations and compatibility discipline.
- Connection pooling and transaction policy.
- Query and index performance.
- Background workers, scheduling, leases, retries, and dead letters.
- Realtime delivery, reconnects, presence, and cache invalidation.
- Backup, point-in-time recovery, restore drills, and failover.
- Search and pgvector provisioning.
- Multi-instance rate limiting and event distribution where required.

The PostgreSQL deployment is therefore a system consisting of the database,
the web application, supervised workers, a scheduler, realtime delivery, object
storage, and observability. It is not only a database connection.

### Sunk cost and switching cost

Historical effort already spent on Convex is sunk cost and should not decide
the destination. The existing schema, functions, production data, realtime UI,
and billing paths are nevertheless real switching cost and migration risk.

The correct response is neither to preserve both providers forever nor to
discard Convex abruptly. Use the current implementation to fund a controlled
migration, then remove it after the new path is proven.

### Developer experience and coding agents

Convex has genuine advantages for coding agents: one TypeScript system,
generated types, automatic transactions, automatic reactivity, and fewer
infrastructure choices. PostgreSQL has a larger ecosystem, more examples,
standard operational tooling, and broad model familiarity.

The strongest improvement is not the database selection by itself. It is one
canonical persistence path with:

- One schema and migration convention.
- Explicit transaction and isolation rules.
- Repository and service boundaries.
- Real database contract tests.
- Deterministic fixtures and migration rehearsal tooling.
- Clear rules against provider-specific APIs in the core data layer.

Coding agents should perform well with PostgreSQL under those constraints. The
current dual-provider ambiguity is harder for them than either provider alone.

### Economics

Do not migrate to save the current Convex subscription. At the present scale,
Convex is likely cheaper in total engineering and operational cost.

Managed PostgreSQL entry pricing may resemble Convex pricing, but the comparison
must include application compute, workers, scheduling, realtime transport,
observability, cache or broker infrastructure, backups, and maintenance time.
At larger sustained scale, PostgreSQL may offer more predictable and controllable
unit economics, but workload shape determines the result.

Before making a cost claim, measure at least 30 representative days of:

- Convex function calls, documents and bytes read, writes, storage, egress,
  subscription updates, and search usage.
- PostgreSQL rows and bytes scanned, connection usage, query latency, worker
  compute, web compute, event delivery, storage, backup, and egress.
- Cost per active workspace, completed chat turn, completed agent run, and
  completed automation.

Current pricing references:

- [Convex pricing](https://www.convex.dev/pricing)
- [Supabase pricing](https://supabase.com/pricing)
- [Neon pricing](https://neon.com/pricing)
- [PlanetScale PostgreSQL pricing](https://planetscale.com/docs/postgres/pricing)
- [Amazon RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)

### Provider-neutral PostgreSQL rules

Use vanilla PostgreSQL plus pgvector in the core application layer. Do not make
Supabase Auth, Supabase Realtime, Neon-specific branching, or another provider
API a requirement for application correctness.

Managed services may provide optional adapters and operational conveniences.
The same schema, migrations, transaction semantics, worker, and recovery
contracts must work against a supported standard PostgreSQL deployment.

For hosted Overlay, benchmark candidate providers against the real workload.
For enterprise and on-premises deployments, support customer-managed PostgreSQL
or a conventional managed service such as RDS or Aurora.

## Realtime after Convex

### Difference from Convex Realtime

PostgreSQL does not natively reproduce Convex's arbitrary reactive queries.
Convex tracks query dependencies, reruns affected queries, delivers new results
over WebSockets, reconnects the client, and keeps related subscribed results on
a consistent database view.

An equivalent Overlay user experience is possible over PostgreSQL, but realtime
must become an explicit application layer.

### Durable event architecture

The required invariant is:

> PostgreSQL stores the authoritative state and the durable event. Realtime
> transport wakes consumers and lowers latency; it is never the only copy.

The intended flow is:

```text
human, agent, or device action
            |
            v
PostgreSQL transaction
  - mutate authoritative state
  - insert a durable domain event
            |
            v
event relay / realtime gateway
  - WebSocket, SSE, or long polling
            |
       +----+----+
       v         v
 browser UI   agents and workflows

reconnect: last durable cursor -> catch up -> resume live delivery
```

`LISTEN/NOTIFY` may wake application processes after commit, but it must remain
an optimization. Disconnected consumers recover from a durable event table and
cursor. Overlay's existing `conversation_events`, notifier, and long-poll route
already follow this principle; the future work is to generalize and harden it.

### Overlay realtime contract

Create an Overlay-owned protocol based on authorized topics, durable cursors,
domain-event schemas, replay, gap detection, versioning, and idempotency.

A durable event should include at least:

- Event ID and exact ingestion sequence or cursor.
- Workspace ID.
- Aggregate type and aggregate ID.
- Event type.
- Actor principal ID.
- Versioned payload.
- Correlation and causation IDs.
- Event time.

Prefer product events such as `message.created`, `approval.requested`,
`agent.run.started`, and `budget.reserved` over raw table-change broadcasts.
Domain events are easier to authorize, evolve, audit, and expose across
workspace boundaries.

Clients subscribe to server-authorized topics such as a workspace,
conversation, agent run, automation run, or resource. The server derives topic
access from verified membership and grants; clients do not establish tenancy
by naming an ID in a prompt or unverified payload.

Delivery should be at least once. Consumers must tolerate duplicates, use
idempotency keys, and refetch projections after gaps. Presence, typing, cursor
movement, and token deltas may use ephemeral pub/sub because they do not define
durable truth.

### Realtime implementation options

- A thin Overlay gateway over the existing PostgreSQL event cursor is the most
  portable canonical contract. Long polling can remain the first transport and
  later be replaced or complemented by WebSockets or SSE.
- Supabase Realtime can provide hosted or self-hosted broadcast and presence,
  but row-change or broadcast delivery is not equivalent to Convex reactive
  queries and must not replace durable replay.
- Electric can be evaluated for local-first and intermittently connected
  clients. It is particularly relevant to desktop, edge, and future device
  scenarios, but its Shape constraints make it an optional sync adapter rather
  than the canonical product model.
- Managed pub/sub or a self-hosted broker may sit behind the gateway. The
  client-facing event contract should not depend on the chosen transport.

### Physical agents and high-volume telemetry

PostgreSQL should hold physical-agent identity, capabilities, authorizations,
tasks, safety constraints, command receipts, approvals, outcomes, ownership,
commercial commitments, and audit records.

It should not be the only transport for high-frequency video, sensor data, or
robot control loops. Those workloads may use object storage, MQTT, NATS,
Kafka-compatible streams, time-series systems, or device-specific infrastructure.
Persist important decisions and outcomes back into the Overlay control plane.

## eve as an agent-execution harness

### Current assessment

eve is a promising execution framework built around the AI SDK, Workflow SDK,
durable sessions, reconnectable streams, human-in-the-loop requests, channels,
connections, subagents, sandboxes, schedules, and observability. It supports
runtime-selected models, tools, skills, instructions, and remote agents through
dynamic definitions.

The current reviewed package is eve `0.44.4`. Its documentation labels the
framework preview software whose API and behavior may change before general
availability. Revalidate the installed version and bundled `node_modules/eve/docs`
before any implementation.

### What changed the original assessment

eve agents are not limited to static filesystem definitions. `defineDynamic`
can resolve runtime models, tools, skills, instructions, and local or remote
subagents from verified session and turn identity. That makes Overlay's
database-authored, multi-tenant agent definitions technically compatible with
eve's runtime model.

eve also provides useful remote-agent primitives:

- Authenticated session creation.
- Durable, cursor-based NDJSON streams.
- Follow-ups, steering or queuing, and cancellation.
- Human-input requests and resolutions.
- Durable remote-agent callbacks.
- Optional forwarding of verified principal metadata without forwarding user
  credentials.

These are useful adapters and prior art for any future eve adoption. The bounded
`@overlay/agent-host` adapter now validates the public client/session transport,
durable cursor, approval, cancellation, and restart-projection seams; it does
not establish eve as Overlay's default runtime or control plane.

### Where eve fits

The strongest candidates are:

1. Personal Work mode, because it is single-user and naturally session-shaped.
2. Automations, because durable scheduling, parking, retries, and approvals are
   central and less coupled to workspace chat.
3. eve-native hosted or remote agents connected through a harness adapter.

The existing `WorkspaceAgentDefinition.harness` field is the right runtime
selection seam. Further eve experiments should use that seam and remain reversible.

### Where eve does not fit

Do not make eve the source of truth for Overlay rooms, DMs, channels, or the
canonical collaboration transcript.

Overlay conversations include humans and multiple agents together with
mentions, threads, reactions, pins, unread state, presence, notifications,
governance, billing, and resource sharing. An eve session is an agent
conversation and execution stream. These are related but different products.

Running the collaboration transcript and eve session history as competing
authoritative stores would recreate the dual-write and reconciliation problem.
Instead:

- Overlay owns workspace, conversation, message, agent-run, billing, approval,
  and authorization records.
- eve may own execution-internal session state for runs assigned to its harness.
- eve stream events are ingested idempotently into Overlay agent-run events and
  projected into Overlay messages.
- Overlay remains responsible for access checks, budgets, usage reservation and
  settlement, cancellation policy, retention, and audit.

### eve adoption gates

Before using eve for production Work mode or automations, prove:

- Dynamic Overlay agent definitions resolve correctly for verified tenants.
- Overlay auth, principal forwarding, and session ownership fail closed.
- The eve session stream maps losslessly and idempotently into Overlay run and
  message events. Preserve `meta.id` or an equivalent stable source key across
  the host bridge so a crash between event acknowledgement and cursor persistence
  cannot duplicate a projection.
- Approval, cancellation, reconnect, retry, and redeploy behavior match Overlay
  product expectations.
- External authorization pauses are represented end to end; the bounded adapter
  currently fails `authorization.required` closed rather than silently parking.
- Usage reservation occurs before paid work and settlement occurs exactly once.
- eve does not become the canonical owner of collaboration or billing state.
- Self-hosted Workflow PostgreSQL world behavior is rehearsed.
- The sandbox security model, egress rules, credential brokering, cleanup, and
  artifact retention are verified.
- Preview API churn can be absorbed behind the harness adapter.

## PostgreSQL migration plan

### Phase 0: finish current product work

Continue using Convex for production and staging while the final product
features are completed. Do not begin provider churn in parallel with unfinished
core product work.

When the maintainer explicitly activates the migration:

- Record the PostgreSQL decision in an ADR.
- Stop adding new Convex-only product capabilities except production fixes.
- Require new persistence work to be PostgreSQL-first or provider-neutral.
- Assign one owner and one tracked parity ledger to the migration.

### Phase 1: revive an isolated PostgreSQL environment

Do not switch staging first. Restore the existing PostgreSQL test project or a
disposable replacement and prove the path in isolation:

1. Install dependencies and run every migration from an empty database.
2. Run migrations from representative older schema versions.
3. Start the supervised worker, scheduler, pgvector, optional broker or Redis,
   object storage, and the web application.
4. Run real PostgreSQL repository and provider contracts.
5. Run authenticated browser QA.
6. Assert that PostgreSQL mode makes no hidden Convex network calls.

### Phase 2: close explicit parity gaps

Audit the current route and capability matrix against the implementations that
actually exist. Resolve stale classifications and complete required gaps,
including:

- Integrations and connector persistence.
- Extension routes.
- Workspace, room, sharing, agent, notification, and presence behavior.
- Realtime reconnect and unread/sidebar invalidation.
- pgvector search, reindex, and deletion.
- Billing, reservations, usage settlement, and account deletion.
- Automation, webhook, background-job, and sandbox reconciliation.

Unsupported surfaces must fail explicitly. PostgreSQL mode must never silently
fall back to Convex.

### Phase 3: reliability, security, and cost qualification

Test at multiples of current peak rather than only with one browser session:

- Kill and restart web processes, workers, schedulers, and realtime relays.
- Verify lease recovery, retries, idempotency, cancellation, and dead letters.
- Exercise multi-instance event delivery and disconnected cursor recovery.
- Revoke access while clients and agents are connected.
- Verify backup, restore, point-in-time recovery, and search reindex procedures.
- Confirm that billing and usage cannot duplicate under retries.
- Compare latency, error rate, and total cost with the measured Convex baseline.

### Phase 4: move staging and soak

Switch `staging.getoverlay.io` only after the isolated environment passes.
Exercise the complete product surface for a sustained period:

- Personal Chat and Work mode.
- Rooms, DMs, threads, mentions, unread state, notifications, and presence.
- Agents, knowledge, files, projects, and outputs.
- Automations, webhooks, integrations, and sandboxes.
- Billing, entitlements, account deletion, and admin/audit behavior.
- Reconnects, deploys, worker restarts, and schema migrations.

A successful build, HTTP 200, or one smoke test is not a soak.

### Phase 5: rehearse production migration

Export Convex production data into disposable PostgreSQL environments at least
twice. Validate:

- Counts and referential mappings.
- Tenant, workspace, conversation, resource, and principal ownership.
- Message ordering, threads, event cursors, and archived/deleted state.
- Billing balances, budgets, reservations, and in-flight work.
- File and object-storage references.
- Search and pgvector reindexing.
- Jobs, automations, webhooks, agents, and approvals.

Prefer a short maintenance window and final write freeze while traffic remains
small enough. If continuous writes are mandatory, use a durable migration
outbox or change stream. Do not implement naive dual writes and assume the two
stores remain consistent.

### Phase 6: production cutover and rollback window

1. Back up both systems.
2. Apply the final write freeze or migration-delta procedure.
3. Import and reconcile the final dataset.
4. Switch application routing to PostgreSQL.
5. Monitor correctness, latency, event lag, billing, worker recovery, and cost.
6. Keep Convex unchanged and available for rollback for an agreed window,
   normally 14 to 30 days or an explicit usage milestone.
7. Roll back if reconciliation or financial invariants fail.

### Phase 7: delete the duplicate provider

After the rollback window closes and production evidence is satisfactory:

- Remove Convex repository implementations and provider branches.
- Remove the Convex schema and functions.
- Remove browser Convex subscriptions and deployment scripts.
- Remove duplicate contracts that exist only for provider parity.
- Preserve the service and repository interfaces that still improve domain
  boundaries and testability.
- Update self-hosting, deployment, recovery, architecture, and operator docs.

### Required cutover gates

Do not cut over until all applicable gates pass:

- Every production route is supported or intentionally removed.
- PostgreSQL mode makes zero Convex calls.
- Real backend contracts pass against the target database.
- Authenticated browser QA covers critical user journeys.
- Realtime ordering, reconnect, gap recovery, multi-tab, and multi-instance
  behavior pass.
- Workspace, room, agent, integration, notification, presence, and search
  parity pass.
- Billing reservation and settlement reconcile exactly under retries.
- Worker, scheduler, workflow, and webhook recovery pass.
- Backup/restore, migration rollback, and search rebuild are rehearsed.
- Production migration rehearsals match counts and ownership invariants.
- Measured latency, reliability, and total cost are acceptable.

## Current source pointers

- [Self-hosting and PostgreSQL runtime](docs/deploy-operate/self-hosting.mdx)
- [Application architecture](docs/develop/architecture.mdx)
- [API source of truth](docs/develop/api-source-of-truth.mdx)
- [Automation durability](docs/develop/automation-durability-and-visual-editor.md)
- [Workspace agent contracts](packages/overlay-workspace-contracts/src/types.ts)
- [Agent run state machine](src/shared/agents/agent-run.ts)
- [Workspace agent invocation](src/server/agents/workspace-agent-invocation.ts)
- [PostgreSQL event notifier](src/server/conversations/PostgresConversationEventNotifier.ts)
- [PostgreSQL conversation events](src/server/conversations/PostgresConversationEvents.ts)
- [Current Daytona sandbox runner](src/server/app-api/v1/daytona/run/sandbox-runner.ts)
