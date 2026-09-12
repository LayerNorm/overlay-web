# Agent-first product plan

This is a good first step, not a finished product specification. A lot will change as we put real agents to work, observe where they fail, and learn which controls people and organizations actually need.

> **Overlay is the control plane for your AI workforce—create or connect agents, give them everything they need to work, and manage them from anywhere.**

## Direction

Overlay is the control plane for an organization's AI workforce. Agents are the primary unit of productivity: durable workers with identities, outcomes, tools, knowledge, permissions, routines, runtime access, activity, and accountable histories.

Chat and collaboration remain important, but they are supporting interaction surfaces. A user should be able to manage an agent in Overlay and work with it from Overlay, Slack, Microsoft Teams, Telegram, or another existing surface without migrating the organization into a new chat product.

The product should optimize for measurable return: useful outcomes completed, time saved, operating cost, reliability, approval burden, and how often an agent can repeat the work successfully.

## Product model

Each agent should have:

- An identity: name, role, owner, team, visibility, and organizational purpose.
- An outcome: a plain-language job it is responsible for completing.
- Conversations: the threads where people direct it, review work, and resolve exceptions.
- Tools and access: software, APIs, browser, terminal, computers, credentials, and approval rules.
- Knowledge: workspace context, connected sources, memories, and agent-specific instructions.
- Routines: scheduled, event-driven, and recurring work owned by the agent.
- Runtime: Overlay-managed or customer-controlled execution, with health and availability.
- Activity: current work, completed runs, artifacts, decisions, failures, cost, and audit history.

Agent identity must remain stable when its model, harness, or runtime changes. Overlay owns the control plane; execution can happen wherever the organization requires.

## Creation should feel effortless

Creating an agent should be a tool call away from any chat. A person describes an outcome in ordinary language, and Overlay can call an agent-creation tool instead of making them start with a configuration form.

The creation conversation should feel like creating a Grok bot: the agent chats with the user, progressively shapes the job, and asks for tool access in context instead of presenting a wall of configuration. The flow should:

1. Ask what outcome the agent should own.
2. Propose a name, instructions, and working cadence.
3. Discover the minimum tools, knowledge, credentials, and runtime access required.
4. Ask for access at the moment it is needed, with a clear explanation of why.
5. Present sensitive grants and consequential actions for explicit approval.
6. Create the agent, open its conversation, and help it complete a first real task.
7. Offer to make successful work recurring only after the first outcome is verified.

The structured editor remains useful for inspection, administration, and precise changes. It should not be the only way to create an agent.

## Product surfaces

### Agents

Agents are the primary navigation item and the default authenticated home. The left sidebar is the workforce roster. Selecting an agent opens its conversation directly instead of navigating to a directory of cards.

The conversation header opens the selected agent's settings in the shared right-side panel. The same panel becomes an overlay dialog on smaller screens. Creating a new agent uses this editor surface for now, while conversational creation is built.

Over time, the selected agent surface should expand beyond one conversation to include its active work, routines, knowledge, access, runtime health, activity, cost, and outcomes without losing the conversation as the fastest way to direct it.

### Chat and collaboration

Chats, direct messages, channels, files, and projects remain available, but below Agents in the hierarchy. They are places where humans and agents coordinate, not the core positioning of the product.

### External surfaces

Slack, Microsoft Teams, Telegram, and similar products are interaction endpoints. Start with narrow, explicit conversation bridges and bot interactions. Do not import an entire external workspace or turn Overlay into a wrapper around another collaboration product.

## Delivery sequence

### Step 1 — Make agents the front door

- Put Agents above Chats in primary navigation.
- Make Agents the default authenticated destination.
- Replace the authenticated agent directory with the selected agent's conversation.
- Open create and edit controls in the shared right-side panel or its small-screen dialog presentation.
- Preserve existing full-page editor URLs as compatibility paths while the new surface settles.

This is the first implemented slice. It establishes the product hierarchy, but it does not yet deliver the complete control plane.

The roster now defaults to the most recently used agent per workspace and orders the sidebar by recency (client-side open history; server-side last-run timestamps are a future refinement). A failed conversation open retries and then surfaces an explicit error with a manual retry instead of sticking on the blank state.

### Step 2 — Create agents from conversation

- Add a first-class `create_agent` tool callable from chat.
- Build the outcome-first interview and access-request flow.
- Convert the accepted proposal into the same durable agent contract used by the editor.
- Open the new agent's conversation and guide it through a verified first outcome.

### Step 3 — Give each agent an operating page

- Add current work, routines, knowledge, tools, runtime status, activity, artifacts, cost, and approvals around the conversation.
- Make failures and blocked access obvious and actionable.
- Let operators pause, resume, reassign, inspect, and improve an agent without changing its identity.
- Decide reconnect semantics for customer-controlled runtimes: hosts are outbound-only, so Overlay cannot wake a sleeping machine. Queued work is claimed automatically when a host returns, but interrupted runs need an explicit Resume — consider auto-resuming host-offline recoveries on heartbeat return once the duplicate-work and Eve-cursor risks are resolved.

### Step 4 — Make successful work repeatable

- Turn completed conversations into scheduled or event-driven routines.
- Attribute every routine and run to an agent.
- Deliver results into Overlay and selected external surfaces.
- Track outcome quality, reliability, intervention rate, time saved, and cost.

### Step 5 — Prove real organizational ROI

- Dogfood recurring research, monitoring, admissions, legal review, and operational workflows.
- Pair product telemetry with customer-defined value measures.
- Use forward deployment to close the gap between a general agent platform and dependable work in each organization.

## Near-term success criteria

The first complete proof is not that a user sent an agent a message. It is that a user described a meaningful recurring job, created or connected an agent, granted the minimum required access, received a verifiable result, and then repeated that result with less intervention.

We should be able to answer, for every active agent: What outcome does it own? What is it doing now? What can it access? What has it produced? What did it cost? Where is it blocked? How much value has it returned?
