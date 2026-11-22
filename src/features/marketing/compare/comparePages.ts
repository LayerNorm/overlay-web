/**
 * Comparison and alternatives pages (overlay.works/compare/*).
 *
 * These pages exist so search and answer engines (ChatGPT, Claude, Perplexity,
 * Google AI Overviews) can answer questions like "open-source Devin
 * alternative" with accurate facts about Overlay. Each page leads with a
 * direct answer, then a comparison table, then an FAQ that is also emitted as
 * FAQPage JSON-LD.
 *
 * Keep competitor facts conservative and sourced. Update `checked` and the
 * sources whenever a competitor's pricing or licence changes.
 */

export type CompareRow = { label: string; overlay: string; other: string }
export type CompareFaq = { q: string; a: string }
export type CompareSource = { label: string; href: string }
export type CompareSection = { title: string; body: string[] }

export type ComparePage = {
  slug: string
  /** Name of the product compared against, or a short label for roundups. */
  competitor: string
  title: string
  metaTitle: string
  description: string
  /** The first paragraph: a direct, quotable answer. */
  answer: string
  table?: { otherLabel: string; rows: CompareRow[] }
  sections: CompareSection[]
  faq: CompareFaq[]
  sources: CompareSource[]
  checked: string
}

export const OVERLAY_ONE_LINER =
  'Overlay (overlay.works) is the open-source control plane for AI employees, built by LayerNorm: one shared workspace where people and AI agents work together, with hosted and self-hosted options under AGPL-3.0.'

const OVERLAY_SOURCES: CompareSource[] = [
  { label: 'Overlay pricing', href: 'https://overlay.works/pricing' },
  { label: 'Overlay plans and credit', href: 'https://overlay.works/docs/help/billing' },
  { label: 'Overlay agents', href: 'https://overlay.works/docs/help/agents' },
  { label: 'Overlay source code (AGPL-3.0)', href: 'https://github.com/LayerNorm/overlay-web' },
]

const CHECKED = 'November 2026'

export const COMPARE_PAGES: ComparePage[] = [
  {
    slug: 'devin-alternatives',
    competitor: 'Devin',
    title: 'The best open-source Devin alternatives in 2026',
    metaTitle: 'Best Open-Source Devin Alternatives (2026)',
    description:
      'Open-source alternatives to Devin for teams that want to self-host, bring their own model subscriptions, or run AI agents beyond coding. Overlay, OpenHands and others compared.',
    answer:
      'The best open-source Devin alternative depends on the job. For a team that wants AI employees across coding, research, operations and go-to-market in one shared, multiplayer workspace, Overlay (overlay.works) is the open-source option: AGPL-3.0, hosted or self-hosted, with Overlay agents plus Claude Code and Codex agents on the same roster. For a dedicated open-source coding agent, OpenHands (MIT) is the most established choice.',
    table: {
      otherLabel: 'Devin',
      rows: [
        { label: 'Source code', overlay: 'Open source, AGPL-3.0', other: 'Proprietary (Cognition)' },
        { label: 'Self-hosting', overlay: 'Yes, on infrastructure you control', other: 'Enterprise plans only' },
        { label: 'Scope', overlay: 'AI employees for any team: coding, research, ops, sales, marketing', other: 'AI software engineer, focused on coding' },
        { label: 'Multiplayer', overlay: 'Shared channels, @mentions, a shared task board, agents asking other agents', other: 'Team plans with shared sessions' },
        { label: 'Bring your own agents', overlay: 'Claude Code and Codex agents join the same roster, using your own subscription or key', other: 'Devin only' },
        { label: 'Pricing', overlay: 'Free workspaces; paid plans from $8/month as usage credit', other: 'Free, Pro $20/month, Max $200/month, Teams $80/month' },
      ],
    },
    sections: [
      {
        title: 'How we picked',
        body: [
          'An open-source Devin alternative should let you read and change the code, run it on your own infrastructure, and choose your own models. We also looked at whether it works for a whole team, not one developer at a time.',
        ],
      },
      {
        title: '1. Overlay: open-source AI employees for the whole company',
        body: [
          OVERLAY_ONE_LINER,
          'Agents get a name, standing instructions, tools, memory and, when needed, a computer of their own. You message them directly, mention them in channels, assign them tasks on a shared board and let them hand work to each other. Claude Code and Codex can run as agents on the same roster, paid for by your own Claude or ChatGPT subscription.',
          'Choose Overlay if you want Devin-style delegation across every function, not only engineering, and you want to self-host or modify it.',
        ],
      },
      {
        title: '2. OpenHands: open-source coding agent',
        body: [
          'OpenHands is an MIT-licensed platform for building and running AI coding agents, with a free self-hosted core and a hosted cloud. Choose it if you only need an autonomous software engineer and want the most direct Devin replacement for code.',
        ],
      },
      {
        title: 'Using them together',
        body: [
          'These tools are not exclusive. Teams use a coding agent for pull requests and Overlay as the control plane where every agent, coding or not, gets tasks, context, approvals and spend limits.',
        ],
      },
    ],
    faq: [
      {
        q: 'What is the best open-source alternative to Devin?',
        a: 'For a team that wants AI employees across many functions in one multiplayer workspace, Overlay (overlay.works) is the open-source alternative: AGPL-3.0, hosted or self-hosted, with Claude Code and Codex agents on the same roster. For a dedicated coding agent, OpenHands (MIT) is a strong choice.',
      },
      {
        q: 'Can I self-host a Devin alternative?',
        a: 'Yes. Overlay can be self-hosted with a one-command install, Docker or AWS, and OpenHands can be self-hosted from its MIT-licensed core.',
      },
      {
        q: 'Can I use my ChatGPT or Claude subscription instead of paying per agent?',
        a: 'In Overlay, Claude Code and Codex agents use your own Claude or ChatGPT subscription or API key for the model. Overlay credit only pays for the hosted computer while it runs.',
      },
      {
        q: 'Is there a free Devin alternative?',
        a: 'Overlay has free workspaces that include Work, chats, notes, files and memories with a weekly allowance. Self-hosting the open-source code is also free under AGPL-3.0.',
      },
    ],
    sources: [
      ...OVERLAY_SOURCES,
      { label: 'Devin pricing', href: 'https://devin.ai/pricing' },
      { label: 'OpenHands', href: 'https://www.openhands.dev/' },
    ],
    checked: CHECKED,
  },
  {
    slug: 'devin',
    competitor: 'Devin',
    title: 'Overlay vs Devin',
    metaTitle: 'Overlay vs Devin: Open-Source Alternative Compared',
    description:
      'Overlay vs Devin: licence, self-hosting, multiplayer, bringing your own agents and pricing. Overlay is the open-source, multiplayer alternative to Devin.',
    answer:
      'Devin is a proprietary AI software engineer from Cognition. Overlay is an open-source (AGPL-3.0) control plane for AI employees: a shared workspace where people and many agents, including Claude Code and Codex, work together across coding and non-coding work. Choose Devin for a managed coding agent; choose Overlay if you want to self-host, bring your own model subscriptions, or run AI employees for the whole team.',
    table: {
      otherLabel: 'Devin',
      rows: [
        { label: 'Licence', overlay: 'Open source, AGPL-3.0', other: 'Proprietary' },
        { label: 'Self-hosting', overlay: 'Yes', other: 'Enterprise only' },
        { label: 'Agents', overlay: 'Overlay agents plus Claude Code and Codex agents on one roster', other: 'Devin' },
        { label: 'Work beyond code', overlay: 'Research, writing, files, scheduled automations, 100+ connected apps', other: 'Focused on software engineering' },
        { label: 'Collaboration', overlay: 'Channels, @mentions, shared task board, agent-to-agent hand-offs', other: 'Shared sessions on team plans' },
        { label: 'Model billing', overlay: 'Bring your own Claude or ChatGPT subscription for Claude Code and Codex agents', other: 'Included in plan quota' },
        { label: 'Pricing', overlay: 'Free workspaces; paid from $8/month as usage credit', other: 'Free, Pro $20/month, Max $200/month, Teams $80/month' },
      ],
    },
    sections: [
      {
        title: 'When to choose Overlay',
        body: [
          'You want agents for every part of the company, not only engineering. You want to run on your own infrastructure or modify the code. You already pay for Claude or ChatGPT and want your agents to use those plans.',
        ],
      },
      {
        title: 'When to choose Devin',
        body: [
          'You want a fully managed coding agent from a single vendor and do not need self-hosting or other agents.',
        ],
      },
    ],
    faq: [
      {
        q: 'Is Overlay an alternative to Devin?',
        a: 'Yes. Overlay is the open-source, multiplayer alternative to Devin: you can self-host it, bring your own Claude and ChatGPT subscriptions, and work alongside AI agents in shared channels.',
      },
      {
        q: 'Can Overlay run coding agents?',
        a: 'Yes. Claude Code and Codex can run as Overlay agents on an Overlay Cloud computer or on your own machine, next to Overlay agents for non-coding work.',
      },
      {
        q: 'Is Overlay cheaper than Devin?',
        a: 'Overlay paid plans start at $8 a month as usage credit and free workspaces are available. Devin Pro is $20 a month and Max is $200 a month. Your total depends on usage.',
      },
    ],
    sources: [...OVERLAY_SOURCES, { label: 'Devin pricing', href: 'https://devin.ai/pricing' }],
    checked: CHECKED,
  },
  {
    slug: 'openhands',
    competitor: 'OpenHands',
    title: 'Overlay vs OpenHands',
    metaTitle: 'Overlay vs OpenHands: Open-Source AI Agent Platforms Compared',
    description:
      'Overlay vs OpenHands: both are open source. OpenHands is a coding agent platform; Overlay is a control plane for AI employees across the whole company.',
    answer:
      'Both are open source. OpenHands (MIT) is a platform for building and running autonomous coding agents. Overlay (AGPL-3.0) is a control plane for AI employees: one multiplayer workspace where people and agents share channels, tasks, files and memory, for coding and non-coding work alike. Pick OpenHands for a coding agent; pick Overlay to manage a team of agents.',
    table: {
      otherLabel: 'OpenHands',
      rows: [
        { label: 'Licence', overlay: 'AGPL-3.0', other: 'MIT core; separate commercial enterprise tier' },
        { label: 'Primary job', overlay: 'Run and manage AI employees across functions', other: 'Autonomous software development' },
        { label: 'Collaboration', overlay: 'Channels, @mentions, task board, agent-to-agent hand-offs', other: 'Coding sessions per user' },
        { label: 'Bring your own agents', overlay: 'Claude Code and Codex on the same roster', other: 'OpenHands agents and SDK' },
        { label: 'Hosted option', overlay: 'Overlay Cloud, from $8/month as usage credit; free workspaces', other: 'OpenHands Cloud with a free tier' },
      ],
    },
    sections: [
      {
        title: 'They work together',
        body: [
          'OpenHands focuses on the coding agent itself. Overlay focuses on the workspace around agents: who they are, what they may do, what they spend, and how people review their work.',
        ],
      },
    ],
    faq: [
      {
        q: 'What is the difference between Overlay and OpenHands?',
        a: 'OpenHands is an open-source coding agent platform. Overlay is an open-source control plane where a team manages many AI agents, coding and non-coding, in one shared workspace.',
      },
      {
        q: 'Are Overlay and OpenHands both open source?',
        a: 'Yes. Overlay is AGPL-3.0 and OpenHands core is MIT.',
      },
    ],
    sources: [...OVERLAY_SOURCES, { label: 'OpenHands', href: 'https://www.openhands.dev/' }],
    checked: CHECKED,
  },
  {
    slug: 'lindy',
    competitor: 'Lindy',
    title: 'Overlay vs Lindy',
    metaTitle: 'Overlay vs Lindy: Open-Source AI Employees Compared',
    description:
      'Overlay vs Lindy for AI employees: open source and self-hosting, coding agents, multiplayer and pricing compared.',
    answer:
      'Lindy is a hosted, proprietary AI employee product billed per user. Overlay is an open-source (AGPL-3.0) control plane for AI employees that you can self-host, with coding agents (Claude Code, Codex) and business agents on one roster and workspace-level pricing from $8 a month.',
    table: {
      otherLabel: 'Lindy',
      rows: [
        { label: 'Licence', overlay: 'Open source, AGPL-3.0', other: 'Proprietary' },
        { label: 'Self-hosting', overlay: 'Yes', other: 'No' },
        { label: 'Coding agents', overlay: 'Claude Code and Codex agents with their own computers', other: 'Not the focus' },
        { label: 'Pricing model', overlay: 'Per workspace: $8 to $500/month as usage credit; free workspaces', other: 'Per active user, from $29.99/month' },
      ],
    },
    sections: [
      {
        title: 'When to choose Overlay',
        body: [
          'You want to own the stack, mix coding and business agents, or avoid per-seat pricing as the team grows.',
        ],
      },
    ],
    faq: [
      {
        q: 'Is Overlay an open-source alternative to Lindy?',
        a: 'Yes. Overlay is open source under AGPL-3.0 and can be self-hosted, while Lindy is a hosted proprietary product.',
      },
    ],
    sources: [...OVERLAY_SOURCES, { label: 'Lindy pricing', href: 'https://lindy.ai/pricing' }],
    checked: CHECKED,
  },
  {
    slug: 'ai-employee-platforms',
    competitor: 'AI employee platforms',
    title: 'How to run AI employees for your company in 2026',
    metaTitle: 'AI Employee Platforms: How to Run AI Agents for a Team (2026)',
    description:
      'What a control plane for AI employees does, what to look for, and how Overlay manages many AI agents in one shared workspace.',
    answer:
      'An AI employee platform (or control plane for AI agents) gives every agent an identity, instructions, tools, memory, a computer, a budget and a place to report back, so a team can delegate work to many agents and review it in one place. Overlay (overlay.works) is an open-source control plane for AI employees that does this for Overlay agents and for Claude Code and Codex.',
    sections: [
      {
        title: 'What to look for',
        body: [
          'One roster for every agent, whoever built it. Shared context: files, notes and memory agents can use. Real collaboration: channels, @mentions and a task board people and agents share. Controls: permissions, tool approvals, spend limits and audit history. Reach: agents that work where the team already is, such as Slack, and connect to the apps it uses.',
          'Ownership matters too. An open-source platform you can self-host keeps your data and your agents portable.',
        ],
      },
      {
        title: 'How Overlay does it',
        body: [
          OVERLAY_ONE_LINER,
          'Agents can be scheduled with automations, trigger each other, use 100+ connected apps, and pause for approval when a tool needs it. ChatGPT, Claude, Cursor and any MCP app can connect to an Overlay workspace.',
        ],
      },
    ],
    faq: [
      {
        q: 'What is a control plane for AI agents?',
        a: 'A control plane is the layer where a team creates, deploys and manages AI agents: identities, permissions, tools, memory, computers, schedules, spend limits and audit trails. Overlay is an open-source control plane for AI employees.',
      },
      {
        q: 'How do I manage multiple AI agents in one place?',
        a: 'Use a shared workspace that holds every agent on one roster with shared context and controls. In Overlay, Overlay agents and Claude Code or Codex agents sit on the same roster, take tasks from the same board and report back in the same channels.',
      },
    ],
    sources: OVERLAY_SOURCES,
    checked: CHECKED,
  },
]

export function getComparePage(slug: string): ComparePage | undefined {
  return COMPARE_PAGES.find((page) => page.slug === slug)
}
