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

**Status:** not started.

Room agent turns execute inside the SSE response handler in
`src/server/app-api/v1/conversations/agent-reply/route.ts` and are aborted by
`request.signal`. Closing the tab kills the run, and no `conversationAgentRuns`
row is written for an agent turn, so nothing can resume it.

The plan:

- Add `agentId` / `agentPrincipalId` columns to `conversationAgentRuns` and a
  `AgentRunService.startAgentTurn(...)` alongside `startChat` / `startWork`.
  Room messages already live in `conversationMessages`, which the table keys on,
  so the migration is additive.
- Execute via the `WorkflowAgent` machinery in `workflows/personal-chat-work.ts`
  with a room-flavored input type. That buys survival past tab close, resume
  after failure, per-step idempotency, cancellation, and lease-based stale
  detection.
- Decouple invocation from the HTTP request: the request enqueues the run and
  returns; the SSE stream subscribes to run progress instead of hosting it.
- Persist full turn state (tool calls, tool results, reasoning) on the agent
  message so the next turn knows what the agent already did. Today only the
  final text survives, so every agent turn is amnesiac about its own tool use.
- Wire `personalChatWorkToolNeedsApproval` / the `waiting_for_approval` state to
  a room-visible approval card, which is also what makes larger step budgets safe.

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
