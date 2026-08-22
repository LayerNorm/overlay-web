# Internal TODOs

Deferred work that is intentionally not implemented yet. Each entry records what
was deferred, why, and what the eventual implementation has to account for.

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

**Status:** Phase 1a landed. Phase 1b not started.

### Landed: the reply is a transcript row (1a)

A room agent no longer holds its reply in the SSE response. It writes into a
`status: 'generating'` row in `conversationMessages` as it generates
(`src/server/agents/agent-message-stream.ts`), so the reply belongs to the
conversation rather than to whoever summoned it. Reloading recovers it, and —
new — every other participant watches it arrive instead of seeing nothing until
it lands.

Both providers already had `status`, `updatedAt`, and the indexes for this, so
no migration was needed. `startAgentMessage` / `appendAgentMessageDelta` /
`finalizeAgentMessage` / `failAgentMessage` on
`ConversationCollaborationRepository`; opening is idempotent on the existing
`agent:{messageId}:{agentId}` nonce. Writes batch at 250ms/200 chars, and the
durable `message.delta` event is throttled to 1s because on the polling
(Postgres) path each one costs every viewer a refetch. `addAgentMessage`
remains the fallback when a row cannot be opened.

### Remaining: the trigger is still client-held (1b)

`deferAgentReply` is still read and ignored in
`src/server/app-api/v1/conversations/message/route.ts`, so
`agent-reply/route.ts` — a request the browser holds — is still the only thing
that starts a turn. The model call is not bound to `request.signal`, so a
disconnect does not abort generation, but nothing restarts a turn the runtime
reclaims, and there is no run record to resume from.

- Add `agentId` / `agentPrincipalId` to `conversationAgentRuns` and
  `AgentRunService.startAgentTurn` alongside `startChat` / `startWork`. Room
  messages already live in `conversationMessages`, which the table keys on, so
  the migration is additive.
- Add `workflows/workspace-agent-turn.ts`, a `"use workflow"` of its own rather
  than a branch inside `personalChatWorkWorkflow`: editing a live workflow body
  breaks determinism for in-flight replays. Reuse the *step* modules — the
  dispatcher pattern in `src/server/conversations/personal-chat-work-tools.ts`
  already solves dynamic tool sets under `"use step"`. Room agents build tools
  through `buildWorkspaceAgentTooling`, not `prepareActTooling`, so they need a
  sibling dispatcher.
- Reserve budget *before* `start()` and pass `reservationId` into the workflow,
  the way `act/route.ts` does. Reserving inside the workflow double-charges on
  replay.
- `message/route.ts` honours `deferAgentReply` by starting that workflow and
  returning. Keep the `authorKind === 'human'` guard in `mention-policy.ts`
  intact through the move — the server-side trigger is exactly where agent
  autonomy could leak in by accident.
- Retire `agent-reply/route.ts` and its `authorization-route-policy.ts` entry.
- Extend the stale-lease reaper to agent turns so a reclaimed run cannot leave a
  row generating forever.
- Raise `MAX_OUTPUT_TOKENS_AGENT` (4,000 today) once turns survive the request.
- Wire `personalChatWorkToolNeedsApproval` / `waiting_for_approval` to a
  room-visible approval card, which is what makes larger step budgets safe.

Deliberately not doing: a `run.readable` live path or a resume route. The row is
required anyway for the transcript and for late joiners, and `run.readable`
serves only the single holder of the runId. `workflowStepEvents` is the same
row-projection choice already made for automations.

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
