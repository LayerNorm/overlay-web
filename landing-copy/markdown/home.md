# Home — `/home`

Status: draft (thesis-first, merged with Energy + xAI inspiration)
Source component (later): `src/features/marketing/pages/MarketingOverviewPage.tsx`
Preview: `../html/home.html`
Metadata (later): title `Overlay — The control plane for your AI workforce`

> Inspiration notes (paraphrased, not lifted): Energy's outcome-first handoff,
> its threads-vs-assistants contrast, and its describe → connect → review
> 3-step. xAI's named roster of bots with jobs, message-like-a-teammate,
> show-it-once-becomes-a-routine, and ask-instead-of-guess approval behavior.
> Both validate our thesis; neither is copied verbatim.

## Nav (also see preview)

Links: `How it works · Control plane · Surfaces · Pricing · Docs` + GitHub
mark → `https://github.com/LayerNorm/overlay-web` + `[Try Overlay]`.

## 1. Hero

- Eyebrow: `Control plane for your AI workforce`
- H1: `The control plane for your AI workforce.`
- Sub: `Give real work to agents — not chats. Create or connect an agent, grant it browsers, tools, knowledge, and permissions, and supervise it from anywhere. It finishes the job, shows its evidence, and returns on schedule.`
- CTAs: `[Create your first agent →]` `[See how it works]`
- Micro-proof: `Research · Monitoring · Operations — start with one recurring job.`
- Visual: agent roster + live run (see section 3), not an empty chat box.

Why: Energy opens with a one-sentence handoff; xAI opens with "give real
work to" teammates. Our H1 keeps the thesis noun ("control plane") while the
sub adopts their outcome-first verb ("give real work").

## 2. Contrast strip (borrowed structure, our words)

- Left: `In other apps, you get threads.` — endless chat history, context rebuilt every session.
- Right: `With Overlay, you get agents that finish work.` — named, persistent, scheduled, accountable.

Keep to two lines + roster visual. This is Energy's threads-vs-assistants
contrast rewritten for our durable-identity thesis.

## 3. How it works — `id="how"`

H2: `Describe the job. Get a verified result. Make it repeatable.`

1. **Describe the outcome.** One sentence is enough. What should this agent own?
2. **Connect its tools.** Browsers, terminals, software, APIs, knowledge, credentials — granted per agent, revocable anytime.
3. **Review the result.** Progress and evidence exposed. It asks instead of guessing when something needs judgment.

Agent-card mock (static v1):
- Header: name + status (`Running / Awaiting approval / On schedule`)
- Roster hint: `Chief · Inbox Manager · Research Scout · Expense Manager …`
- Approval row: `Needs approval: publish brief → Approve / Reject`
- Routine row: `Created routine: Month-end close · runs Mon 9am`
- Evidence row: `9 receipts matched · $2,340 across 3 trips · 1 flagged`

Caption: `The agent is the durable unit. Runtimes can change — threads, knowledge, permissions, and history don't.`

## 4. Control plane grid — `id="control"`

H2: `Autonomy you can govern.`
Intro: `Chat is a surface. Overlay owns everything around the work.`

- **Deploy anywhere** — Overlay Cloud, your machine, or another harness. Same identity.
- **Context & access** — knowledge, credentials, tools, permissions per agent.
- **Schedules & routines** — show it once, it runs on its own next time.
- **Approvals & audit** — what it did, what it changed, what it costs, how to stop it.
- **Observability & cost** — runs, exceptions, approval burden, time saved.
- **Real capabilities** — browsers, terminals, software, APIs, connected computers.

## 5. Surfaces — `id="surfaces"`

H2: `Meet people where they work.`
Body: `Slack, Teams, and Telegram are distribution surfaces — not migrations. Message agents like teammates; configure and supervise them in Overlay.`
Chips: `Overlay · Slack · Microsoft Teams · Telegram`

## 6. Proving grounds

H2: `Research, monitoring, and operations first.`
Intro: `Together they test synthesis, persistent observation, and real-world action.`

- **Research** — `Watch these sources. Synthesize Friday. Post the brief with evidence.`
- **Monitoring** — `Check hourly. Alert only on real change. Log every run.`
- **Operations** — `Triage the queue. Draft the action. Wait for approval before touching prod.`

## 7. Closing

H2: `Give every recurring job to an agent.`
Sub: `Start with one. Prove the outcome. Make it repeatable with less intervention.`
CTAs: `[Create your first agent →]` `[Deploy privately]`
Sign-off: `Built by LayerNorm · Open and self-hostable`
