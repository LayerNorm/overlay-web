# Brief: durable execution for AI agents

We run long-lived AI agents (Claude Code, Codex) inside cloud sandboxes. Runs last minutes to hours, survive
machine restarts, stream progress to a chat UI, and wait on human approvals. We need a decision memo on which
durable-execution approach to build that on.

Compare these six options:

1. Temporal
2. Inngest
3. Restate
4. Vercel Workflow (the Workflow DevKit / `workflow` package)
5. Cloudflare Workflows
6. DBOS

For each, find: execution model (how state survives crashes), how it waits for external events or humans,
long-running limits, language support, hosting options (managed vs self-hosted), and pricing approach.
Use web search and cite sources. Where something can't be verified, say so rather than guessing.

## Deliverables (all inside this drive)

| Path | What |
| --- | --- |
| `research/sources.md` | At least 8 sources: title, URL, one-line takeaway |
| `research/<option>.md` | One file per option (6 files), with the facts above and citations |
| `data/comparison.csv` | One row per option; columns: option, execution_model, human_wait, max_duration, languages, hosting, pricing_model |
| `report/memo.md` | 1,200–1,800 word decision memo with a clear recommendation and risks |
| `report/exec-summary.md` | At most 200 words |
| `INDEX.md` | Links to every file above with a one-line description |
| `CHECKLIST.md` | Each deliverable, ticked when done, with its word or row count |

Work through it end to end without asking questions. Save as you go: write each research file as soon as it is
done instead of holding everything until the end.
