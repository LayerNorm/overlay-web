# Internal TODOs

Deferred work that is intentionally not implemented yet. Each entry records what
was deferred, why, and what the eventual implementation has to account for.

---

## Overlay Cloud managed agent environments

**Status:** deferred — connected user-owned environments ship first; the managed
execution path remains implemented but unavailable in product UI.

`OVERLAY_FEATURE_OVERLAY_CLOUD_ENVIRONMENTS` must remain false in staging and
production until every release gate below has current evidence. The managed
route also rejects requests while the flag is off, so hiding the UI is not the
security boundary.

Before enabling Overlay Cloud:

- publish, scan, and pin the Agent Host image by immutable digest;
- pass live Vercel Sandbox conformance with the production-like image;
- finish provider and BYOK credential brokering without copying local auth
  directories into a sandbox;
- enforce and verify network/egress policy and secret redaction;
- prove maximum-lease reservation, exact-once settlement, invoice
  reconciliation, and spend alerts;
- prove idle shutdown, hard timeout, cancellation, snapshot cleanup, and
  orphan reconciliation;
- complete a deep security review of provisioning, tenancy, artifacts, and
  provider callbacks; and
- expose the agent-editor option only from a server-authoritative readiness
  capability backed by these gates, not from a client flag alone.

The provider-neutral sandbox runtime, Vercel and Daytona adapters, managed API,
and bridge protocol stay in the codebase for this future release. Do not create
a second execution or transcript path when the UI is restored.

---

## Agent as principal (deferred from agent Phase 2)

**Status:** deferred — the delegate model shipped instead.

Today a workspace agent acts as a *delegate*: when it runs, its tools
authenticate as the human who triggered it (`actorUserId`), and its capability
is the intersection of the agent's own tool grant with what that human can
already do. Every tool call is stamped with the agent principal for audit
(`agentPrincipalId` / `agentId` on the tool options), so the trace answers "which
agent did this, on whose behalf" — but the underlying credentials are the
human's.

The eventual model is **agent as principal**: the agent holds its own identity
the way a human employee does.

What that requires:

- **Per-agent connector auth.** Each agent needs its own OAuth grants for
  Composio/integration providers rather than borrowing the triggering user's
  connections. This is the bulk of the work and needs a UI: "connect Gmail for
  the Overlay agent" as a distinct flow from "connect Gmail for yourself".
- **Agent-scoped workspace permissions.** `workspacePrincipals` already models
  agents as first-class principals with a `principalId`; memberships and roles
  need to apply to agent principals so an agent can be, say, a `member` of one
  team and have no access to another.
- **Service-auth without a human subject.** `buildServiceAuthToken` is keyed on
  `userId`. An agent-as-principal turn has no human subject when it runs
  autonomously, so the token needs to carry a principal id instead.
- **Billing subject.** `programmaticSubjectId` already supports `agent:{id}`;
  spend attribution should follow the agent principal rather than the mentioner
  once the agent runs on its own credentials.
- **Migration.** Existing agent-authored artifacts (memories, notes, automations)
  are owned by the triggering human today. Decide whether they get reassigned to
  the agent principal or stay where they are.

Do not retrofit this after agents gain more capabilities than they have now —
the longer the delegate model runs, the more surface assumes a human subject.

### Per-connector tool grants

Related but smaller: the `integrations` group in `src/shared/agents/tool-groups.ts`
is all-or-nothing — an agent granted connected apps can reach every app the
workspace has connected. Per-connector grants ("this agent may use Linear but
not Gmail") need a dynamic section in the agent editor driven by the connected
connector list, since `AGENT_TOOL_GROUPS` is a static array. The plumbing is
already there: `prepareActTooling` takes `accountAllowedConnectorIds`, which
`intersectConnectorPolicies` narrows.

---

## Agent autonomy: self-initiated work and delegation (deferred from agent Phase 4)

**Status:** deferred — agents only respond to human triggers.

`resolveMentionFirstInvocations` in `src/server/agents/mention-policy.ts` returns
an empty list unless `authorKind === 'human'`. That is deliberate. Agents cannot
currently:

- start work on their own (no self-continuation after a turn ends),
- delegate to another agent by @mentioning it,
- be triggered by another agent's message, an automation's output, a task
  assignment, or an external webhook.

When this is implemented, the trigger policy has to ship **with its guards in the
same change**, not after:

- **Depth limit** on agent→agent chains (an agent mentioning an agent that
  mentions the first agent is an infinite loop that bills real money).
- **Per-chain token/step budget** shared across the whole delegation tree, not
  per-agent — the existing `MAX_AGENTS_PER_MESSAGE` cap only bounds fan-out from
  a single human message.
- **Provenance on every turn**: which trigger started this chain, and which human
  is ultimately accountable for the spend.
- **Kill switch**: a workspace-level way to stop an in-flight chain.

Related: agents that initiate long work also need the presence/streaming UX from
Phase 4 (a live status message in the room) or a long autonomous run reads as a
dead channel.

---

## Durable agent runs (agent Phase 3)

**Status:** landed. Follow-ups below.

A room agent turn is now owned by a durable run rather than by an HTTP request.

- The reply is a `status: 'generating'` row in `conversationMessages`, written
  as it is generated (`src/server/agents/agent-message-stream.ts`), so it
  survives a reload and every participant watches it arrive — not only the
  person who summoned the agent. Writes batch at 250ms/200 chars; the durable
  `message.delta` event is throttled to 1s because on the polling transcript
  each one costs every viewer a refetch.
- Saving the human message is what starts the turn
  (`src/server/app-api/v1/conversations/message/route.ts`). The browser is no
  longer the trigger, so closing the tab cannot end the reply. The client-held
  `agent-reply` route, its client method, and `deferAgentReply` are all gone.
- `workflows/workspace-agent-turn.ts` owns the turn, with lifecycle steps in
  `src/server/agents/workspace-agent-turn-lifecycle.ts`. `conversationAgentRuns`
  gained a `room` mode and `agentId` / `agentPrincipalId` (migration 0063).
- Room runs carry a 30-minute lease so the existing stale-run sweep can fail a
  turn whose workflow the platform lost, instead of leaving a reply generating
  forever.
- `resolveWorkspaceAgentInvocations` and `runWorkspaceAgentTurn` are separate:
  the send path resolves who owes a reply without reading the transcript, and
  each turn loads the room fresh, because a durable turn can start long after
  the request that triggered it.
- `MAX_OUTPUT_TOKENS_AGENT` is 16k now that a turn is not bounded by a response.
- A finished agent reply raises workspace activity exactly as a teammate's
  message does. `recordMessageActivity`'s fan-out is now shared with a
  `notifyAgentMessage` path on both providers, taking the author as an explicit
  principal because an agent has no user id. Fires on `finalizeAgentMessage` and
  on the non-streamed `addAgentMessage` fallback; a failed turn raises nothing.
- Both Postgres message mappers dropped `tokens`, so usage was visible on Convex
  and invisible on Postgres. `tokens` is now on `ConversationMessageRow` and
  mapped by both.

### Follow-ups

- **`WorkflowAgent` for the inner loop.** The model turn runs as a single
  `"use step"`, so replay granularity is the whole turn rather than the last
  completed tool call. `WorkflowAgent` would fix that, but it streams into the
  workflow's own output stream, which only the holder of the run id can read —
  a room needs every participant to see the reply, so the transcript row wins.
  Revisit by teeing the writable, and measure before committing.
- **Room approval card.** `personalChatWorkToolNeedsApproval` and the
  `waiting_for_approval` state exist; nothing in a room can grant approval yet,
  so an approval-gated MCP tool still stalls. This is what makes a larger
  channel step budget safe (`MAX_TOOL_STEPS_AGENT_CHANNEL` is 8).
- **Stop control.** Personal chat has `conversations/stop`; a room turn has no
  cancel. Maps to workflow run cancellation.
- **Per-agent concurrency.** `MAX_AGENTS_PER_MESSAGE` caps fan-out per message
  but nothing queues a single agent mentioned repeatedly.
- **Model fallback on retry.** `agentModelAttempts` handles entitlement
  fallback within a turn; a failed run does not yet retry on a different model
  the way automations do.

---

## Personal chat Work mode parity

**Status:** streaming metadata and progress persistence landed. One gap remains.

Work mode and room agents share a substrate — both are `"use workflow"` durable
runs with an `agentRuns` record — but they stream differently, and the
differences were visible.

- **Source citations** never reached a Work turn. Chat mode attaches them
  through `toUIMessageStream`'s `messageMetadata` callback; Work mode reaches
  the client through `createModelCallToUIChunkTransform`, which carries only the
  raw model call and has no metadata hook. `createUiMessageMetadataTransform`
  now attaches them to the `start` and `finish` chunks.
- **A reload mid-turn showed an empty bubble.** Work mode persisted nothing
  until `finalizePersonalChatWork`. It now publishes absolute content into the
  run's assistant row from two places: `onStepEnd` inside the workflow (durable,
  survives a disconnect, model-step granularity) and a tee of the response
  stream drained in `after()` (finer grained, lasts only as long as the
  request). Both go through `recordAgentRunProgress`, which writes absolute
  content and refuses a run or row that is no longer live, so the two writers
  converge instead of fighting.

### Remaining gap

Per-token persistence that survives a disconnect is **not** reachable while Work
mode uses `WorkflowAgent`. The workflow body cannot write to the database at all
— its module graph is bundled for the workflow runtime, where Node built-ins do
not exist — so every write must be a `"use step"`. Calling a step from a stream
transform would interleave nondeterministically with the agent loop's own tool
steps and break replay ordering. `onStepEnd` is the finest deterministic hook
available, and for a single-step reply it fires once at the end.

Closing that gap means giving Work mode the room treatment: `streamText` inside
one step. That buys per-token durability and costs the tool-approval flow, which
depends on `WorkflowAgent`'s approval detection plus `createHook` to pause
mid-turn — a single step cannot pause. Not worth it until approvals are
redesigned.

Also still missing in Work mode: `routedModelId` metadata. The chat path reads
the routed model off the provider response as it streams; in Work mode the model
call happens inside the workflow, so the route has nothing to read.

---

## Runtime consolidation (agent Phase 5)

**Status:** not started.

`packages/overlay-agent-runtime` has the right abstraction (`AgentRuntime`,
`ToolRegistry`, `CompositeContextBuilder` with memory/knowledge/file builders,
`persistTurn`) and is currently unused. After Phases 1–3, the three execution
paths — `workspace-agent-invocation.ts`, `act/route.ts`, and
`workflows/personal-chat-work.ts` — share context loading, tooling, and
execution through ad-hoc calls rather than a boundary. Collapse them onto the
runtime package so that personal chat becomes "an agent turn where the principal
is you and the room is private".

Do this last: designing the abstraction before the requirements are known is how
the package ended up written and unused the first time.
