import type { Ext, FileItem, ChatSeed, AutoSeed } from './demo-types'
import { A, Y } from './demo-types'

/** Chats, files, extensions and automations for the demo. The text is placeholder content. */
export const CHAT_SEED: ChatSeed[] = [
  { title: 'Summarize Q3 board notes', msgs: [
    Y('', 'Summarize the Q3 board notes in five bullets. Focus on decisions, not discussion.'),
    A('', '1. Revenue grew 18% quarter over quarter to $4.2M ARR\n2. Churn fell to 2.1% after the onboarding changes\n3. Two enterprise pilots converted to annual contracts\n4. Approved hiring for six roles across engineering and support\n5. Series A timeline unchanged; kickoff in January', { tool: 'Worked for 9s, called 2 tools' }),
    Y('', 'Turn bullet 3 into a short update for the sales team.'),
    A('', 'Two enterprise pilots converted to annual contracts this quarter. The common factors were a named internal owner during the pilot and a security review completed in the first two weeks. Please prioritize both steps in active pilots.'),
    Y('', 'What risks did the board raise?'),
    A('', 'Three came up:\n1. Concentration — the top five customers are 34% of revenue\n2. Hiring pace relative to runway\n3. Dependence on a single model provider for the core product\nThe board asked for a mitigation plan on each by the next meeting.', { tool: 'Worked for 6s, called 1 tool' }),
    Y('', 'Draft the mitigation plan outline.'),
    A('', '1. Concentration — no customer above 10% of revenue by Q2; add two mid-market segments\n2. Runway — stage hires against ARR milestones and review monthly\n3. Provider dependence — route through a gateway with fallback models and quarterly cost tests\nOwners and dates are left blank for you to assign.'),
    Y('', 'Put this in a doc called “Board follow-ups” and share it with the leadership team.'),
    A('', 'Created “Board follow-ups” in Files and shared it with the leadership team (view access). I also added a reminder to review progress before the next board meeting.', { tool: 'Worked for 12s, called 3 tools' }),
  ] },
  { title: 'Draft launch email', msgs: [
    Y('', 'Draft a launch email for the agents release. Audience: existing customers.'),
    A('', 'Draft:\n**Subject:** Your first AI employee is ready\nThree sentences on what is new, one on how to try it in five minutes, and a single button: “Create an agent”. It is under 120 words.', { tool: 'Worked for 11s, called 2 tools' }),
    Y('', 'The subject line is too generic. Give me five options.'),
    A('', '1. Agents are now in Overlay\n2. Hire your first AI employee in five minutes\n3. Meet agents with memory, tools and a computer\n4. Your team now has an AI employee\n5. New: agents that work while you sleep\nI would test 2 against 4.'),
    Y('', 'Use 2. Make the body more specific about what an agent can do.'),
    A('', 'Updated. The body now lists three concrete examples: triage support tickets each morning, review pull requests on push, and prepare a daily briefing from your inbox and calendar.'),
    Y('', 'Good. Create a version for people on the free plan with an upgrade note.'),
    A('', 'Created a second version. It keeps the same opening, then adds one paragraph explaining that free workspaces can create one agent and the Pro plan unlocks ten, with a link to pricing.', { tool: 'Worked for 8s, called 1 tool' }),
    Y('', 'Schedule both for Tuesday at 10am, split by plan.'),
    A('', 'Scheduled for Tuesday at 10:00 AM: version 1 to 2,340 paying customers and version 2 to 8,915 free users. I will send you the open and click rates on Wednesday morning.', { tool: 'Worked for 15s, called 4 tools' }),
  ] },
  { title: 'Compare vector databases', msgs: [
    Y('', 'We have about 5M documents. Pgvector or a dedicated vector database?'),
    A('', 'At 5M documents pgvector with an HNSW index is a good fit and keeps your stack simple. A dedicated store makes sense when you need hybrid search at scale, sub-10ms p99 under heavy load, or independent scaling of search from your primary database.', { tool: 'Worked for 14s, called 3 tools' }),
    Y('', 'What would the memory footprint look like?'),
    A('', 'For 5M vectors at 1536 dimensions:\n1. Raw vectors: about 30 GB\n2. HNSW index overhead: roughly 1.5x, so about 45 GB\n3. Recommended RAM: 64 GB so the index stays hot\nQuantizing to 8-bit cuts this by about 4x with a small recall drop.'),
    Y('', 'How much recall do we lose with quantization?'),
    A('', 'Typically 1 to 3 points on recall@10 at the same latency, which a re-ranking step on the top 50 results usually recovers. I would benchmark on a 100k sample of your own queries before deciding.', { tool: 'Worked for 21s, called 4 tools' }),
    Y('', 'Write a plan for that benchmark.'),
    A('', '1. Sample 100k documents and 500 real queries\n2. Measure recall@10, p50 and p99 latency for full precision, 8-bit and 4-bit\n3. Add re-ranking on the top 50 and re-measure\n4. Compare cost per million queries for pgvector and one managed option\nExpected effort: two days.'),
    Y('', 'Create a Linear ticket for it and assign it to the search team.'),
    A('', 'Created SEARCH-341 “Vector index benchmark” with the plan above and assigned it to the search team.', { tool: 'Worked for 9s, called 2 tools' }),
  ] },
]
export const FILES: FileItem[] = [
  { name: 'Launch plan.md', kind: 'md' }, { name: 'Q3 board notes.md', kind: 'md2' }, { name: 'Pricing research.csv', kind: 'csv' }, { name: 'Brand guidelines.pdf', kind: 'pdf' },
]
export const EXT_SEED: Ext[] = [
  { n: 'Slack', t: 'app', l: 'slack', d: 'Read channels, post updates, answer threads.', on: true },
  { n: 'GitHub', t: 'app', l: 'github', d: 'Open PRs, review code, triage issues.', on: true },
  { n: 'Gmail', t: 'app', l: 'gmail', d: 'Draft and send email from your inbox.', on: false },
  { n: 'Linear', t: 'app', l: 'linear', d: 'Create and update issues and projects.', on: true },
  { n: 'Notion', t: 'app', l: 'notion', d: 'Search and edit pages and databases.', on: true },
  { n: 'Google Calendar', t: 'app', l: 'calendar', d: 'See your schedule and book meetings.', on: true },
  { n: 'Perplexity', t: 'skill', l: 'perplexity', d: 'Research the web and cite sources.', on: true },
  { n: 'Sentry', t: 'skill', l: 'sentry', d: 'Triage errors and open fixes.', on: false },
  { n: 'Playwright', t: 'mcp', l: 'playwright', d: 'Drive a real browser to test and scrape.', on: false },
]
const CONFIRM = 'Reply **“confirm”** to create and enable it, or tell me what to change.'
export const AUTO_SEED: AutoSeed[] = [
  { n: 'Competitor launch monitor', title: 'Daily Competitor Launch Monitor', scope: 'personal', msgs: [
    Y('', 'every weekday at 8am, check our five main competitors for new changelog entries, pricing changes and press releases, and post what changed to #product with a one-line take on what it means for us'),
    A('', 'I can set that up. Here is the draft:', { tool: 'Worked for 7s, called 5 tools', code: { label: 'text', lines: ['1. Every weekday at 8:00 AM in your timezone.', '2. For each competitor, read the changelog, pricing page and newsroom.', '3. Compare with yesterday’s snapshot and keep only real changes.', '4. Post a digest to #product: what changed, a one-line take, a link.', '5. Skip the post if nothing changed.'] }, after: CONFIRM }),
    Y('', 'add Linear and Cursor to the list, and flag any pricing change as high priority'),
    A('', 'Updated. The watchlist now has seven competitors, and pricing changes are posted first with a “High priority” label.', { tool: 'Worked for 4s, called 2 tools', code: { label: 'text', lines: ['Watchlist: 7 competitors (added Linear, Cursor)', 'Priority: pricing changes → “High priority”, posted first', 'Quiet days: no post'] }, after: CONFIRM }),
    Y('', 'confirm'),
    A('', 'The automation is created and enabled. The first run is tomorrow at 8:00 AM. I saved today’s snapshot as the baseline, so tomorrow’s digest only shows real changes.', { tool: 'Worked for 5s, called 3 tools' }),
    Y('', 'run it once now so I can see the format'),
    A('', 'Test run complete. I posted a sample to #product-test:\n1. **High priority** — Cursor raised Team pricing from $32 to $40 per seat\n2. Linear shipped “Triage Intelligence” in its changelog\n3. No other changes across the remaining five competitors\nWhich channel should the live posts go to?', { tool: 'Worked for 41s, called 9 tools' }),
    Y('', '#product-intel'),
    A('', 'Done. Posts will go to #product-intel starting tomorrow at 8:00 AM.', { tool: 'Worked for 4s, called 1 tool' }),
  ] },
  { n: 'Weekly revenue digest', title: 'Weekly Revenue Digest', scope: 'personal', msgs: [
    Y('', 'every monday at 9am, pull last week’s revenue from Stripe and send me a summary with new MRR, churn, expansion and the top five accounts by growth'),
    A('', 'Here is the draft:', { tool: 'Worked for 6s, called 4 tools', code: { label: 'text', lines: ['1. Every Monday at 9:00 AM.', '2. Pull last week’s subscriptions and invoices from Stripe.', '3. Calculate new MRR, churned MRR and expansion MRR.', '4. List the five accounts with the largest growth.', '5. Send the summary to you by email and Slack DM.'] }, after: CONFIRM }),
    Y('', 'compare against the previous four weeks too'),
    A('', 'Added a four-week trend for each metric, with a flag when a metric moves more than 15% from its average.', { tool: 'Worked for 4s, called 1 tool', code: { label: 'text', lines: ['6. Compare each metric with the 4-week average.', '7. Flag any metric that moves more than 15%.'] }, after: CONFIRM }),
    Y('', 'confirm'),
    A('', 'Enabled. The next run is Monday at 9:00 AM. I will also keep a running sheet in Files called “Revenue digest log”.', { tool: 'Worked for 5s, called 3 tools' }),
    Y('', 'send me last week’s now'),
    A('', 'Last week:\n1. **New MRR** $18.4k (+9% vs average)\n2. **Churned MRR** $3.1k (within range)\n3. **Expansion MRR** $6.7k (+22% vs average, flagged)\nLargest growth: Northwind +$2.4k, Ridgeline +$1.9k, Alder +$1.1k. The full summary is in your email.', { tool: 'Worked for 52s, called 8 tools' }),
  ] },
  { n: 'PR review on push', title: 'Review Every Push to Main', scope: 'personal', msgs: [
    Y('', 'when someone pushes to main, review the diff and comment on the PR with anything risky'),
    A('', 'Here is the draft:', { tool: 'Worked for 5s, called 3 tools', code: { label: 'text', lines: ['1. Trigger: push to main on the web repository.', '2. Read the diff and the linked pull request.', '3. Check for missing tests, migrations and risky changes.', '4. Comment on the PR with findings, or approve silently if clean.'] }, after: CONFIRM }),
    Y('', 'also tag the code owner when it touches billing or auth'),
    A('', 'Added. Changes under `billing/` or `auth/` will tag the code owner in the comment.', { tool: 'Worked for 4s, called 2 tools', code: { label: 'text', lines: ['5. If files under billing/ or auth/ changed, tag the code owner.'] }, after: CONFIRM }),
    Y('', 'confirm'),
    A('', 'The automation is created and enabled. I ran it against the last three pushes: one comment about a missing test and two clean reviews.', { tool: 'Worked for 18s, called 6 tools' }),
  ] },
  { n: 'Weekly team update', title: 'Weekly Team Update', scope: 'workspace', msgs: [
    Y('', 'every friday at 4pm, write a short team update from this week’s merged PRs and post it in #team'),
    A('', 'Here is the draft:', { tool: 'Worked for 5s, called 3 tools', code: { label: 'text', lines: ['1. Every Friday at 4:00 PM.', '2. Collect the week’s merged pull requests and closed tickets.', '3. Group them by area and write three to five bullets.', '4. Post the update in #team.'] }, after: CONFIRM }),
    Y('', 'confirm'),
    A('', 'Enabled. The first update will post this Friday at 4:00 PM. I will keep the same format each week so it is easy to scan.', { tool: 'Worked for 4s, called 2 tools' }),
    Y('', 'run it now for this week so I can review the format'),
    A('', 'Here is this week’s update, posted to #team-test:\n1. **Platform** — retry logic for failed webhooks shipped (#471); session token migration is in review\n2. **Product** — grouped notification digest is behind a flag for 10% of workspaces\n3. **Docs** — setup guide rewritten with new screenshots\nWant any section reordered or a “Next week” line added?', { tool: 'Worked for 38s, called 7 tools' }),
    Y('', 'add a next week line and tag owners'),
    A('', 'Updated. Each item now tags its owner, and the update ends with a “Next week” line built from open milestones and tickets due.', { tool: 'Worked for 6s, called 2 tools' }),
  ] },
]
export const REPLIES = [
  "On it — I'll post an update here as soon as it's done.",
  "Got it. I'll start now and flag anything that needs your call.",
  'Done. Want me to share the result with the team?',
  "Sure — give me a minute and I'll come back with a draft.",
]
export const AUTO_REPLIES = [
  'Got it — I updated the draft. Reply **“confirm”** to create and enable it.',
  'Done. The automation is enabled and will run on schedule.',
]
