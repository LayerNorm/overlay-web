export type AutomationScheduleDraft =
  | { kind: 'interval'; intervalMinutes: number }
  | { kind: 'daily'; hourUTC: number; minuteUTC: number }
  | { kind: 'weekly'; dayOfWeekUTC: number; hourUTC: number; minuteUTC: number }
  | { kind: 'monthly'; dayOfMonthUTC: number; hourUTC: number; minuteUTC: number }

export interface AutomationDraftSummary {
  name: string
  description: string
  instructions: string
  graphSource?: string
  schedule: AutomationScheduleDraft
  timezone: string
  detectedIntegrations: string[]
  missingFields: string[]
  confidence: 'low' | 'medium' | 'high'
  reason: string
}

const KNOWN_INTEGRATIONS = [
  'Gmail',
  'Google Calendar',
  'Google Sheets',
  'Google Drive',
  'Slack',
  'Notion',
  'GitHub',
  'Linear',
  'Discord',
  'Outlook',
  'HubSpot',
  'Salesforce',
  'Airtable',
  'Jira',
  'Asana',
] as const

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clip(value: string, max = 220): string {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1).trim()}...`
}

function inferTitle(userText: string): string {
  const cleaned = normalizeWhitespace(
    userText
      .replace(/^(please|can you|could you|help me|i want you to)\s+/i, '')
      .replace(/^(every|each|scheduled|automate)\s+/i, ''),
  )
  const base = cleaned.split(/[.!\n]/)[0] ?? cleaned
  const titled = base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Scheduled automation'
  return titled.length > 72 ? `${titled.slice(0, 69).trim()}...` : titled
}

function mermaidLabel(value: string): string {
  return value.replace(/["\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildGraphSourceFromSteps(steps: string[]): string {
  const nodes = steps.map((step, index) => {
    const label = mermaidLabel(step).slice(0, 96)
    return `  step${index + 1}["${index + 1}. ${label}"]`
  })
  const edges = steps.slice(1).map((_, index) => `  step${index + 1} --> step${index + 2}`)
  return ['flowchart TD', ...nodes, ...edges].join('\n')
}

function buildPointerSteps(input: { userText: string; assistantText?: string }): string[] {
  const source = [input.userText, input.assistantText].filter(Boolean).join('\n')
  const normalized = source.toLowerCase()
  const asksForNewsDigest = /\b(news|digest|headlines)\b/.test(normalized) && /\b(email|gmail|send)\b/.test(normalized)

  if (asksForNewsDigest) {
    return [
      'Call `web_search` with query "top tech news today"',
      'Call `web_search` with query "top AI news today"',
      'Call `web_search` with query "top open source news today"',
      'Call `web_search` with query "top startup funding news today"',
      'Call `web_search` with query "top world news today"',
      'Run all news searches in parallel simultaneously',
      'Take results and format into an email body with one section per category, 3-5 stories each, 2-3 sentence summary per story, and source links inline',
      "Build the subject line: Your Daily News Digest - [Today's Date]",
      'Call `GMAIL_SEARCH_THREADS` or use the known email address to confirm the recipient',
      'Call `GMAIL_SEND_EMAIL` with the subject, formatted body, and recipient email',
      'Post a concise completion summary to the automation chat, including any failures or skipped categories',
    ]
  }

  const assistantLines = (input.assistantText || '')
    .split('\n')
    .map((line) => line.trim().replace(/^[-*\d.)\s]+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 8)

  if (assistantLines.length >= 3) {
    return [
      ...assistantLines,
      'Post a concise completion summary to the automation chat, including anything that still needs attention',
    ]
  }

  return [
    `Interpret the user request: ${clip(input.userText, 240)}`,
    'Identify the required tools, integrations, recipient/account details, and missing inputs before acting',
    'Call the relevant search, read, or integration tools needed to gather fresh source data',
    'Run independent data-gathering tool calls in parallel whenever their inputs do not depend on each other',
    'Transform the gathered results into the requested output format with clear sections and source links when available',
    'Call the final delivery or update tool required by the request',
    'Post a concise completion summary to the automation chat, including anything that still needs attention',
  ]
}

function detectIntegrations(text: string): string[] {
  const normalized = text.toLowerCase()
  return KNOWN_INTEGRATIONS.filter((name) => normalized.includes(name.toLowerCase()))
}

function inferSchedule(text: string): AutomationScheduleDraft {
  const normalized = text.toLowerCase()
  if (/\b(hourly|every hour)\b/.test(normalized)) {
    return { kind: 'interval', intervalMinutes: 60 }
  }
  if (/\b(every\s+(\d+)\s+minutes?)\b/.test(normalized)) {
    const match = normalized.match(/\bevery\s+(\d+)\s+minutes?\b/)
    const minutes = Math.max(1, Math.min(24 * 60, Number(match?.[1] ?? 60)))
    return { kind: 'interval', intervalMinutes: minutes }
  }
  if (/\bweekly|every week|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?\b/.test(normalized)) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const dayOfWeekUTC = weekdays.findIndex((day) => normalized.includes(day))
    return { kind: 'weekly', dayOfWeekUTC: dayOfWeekUTC >= 0 ? dayOfWeekUTC : 1, hourUTC: 14, minuteUTC: 0 }
  }
  if (/\bmonthly|every month\b/.test(normalized)) {
    return { kind: 'monthly', dayOfMonthUTC: 1, hourUTC: 14, minuteUTC: 0 }
  }
  return { kind: 'daily', hourUTC: 14, minuteUTC: 0 }
}

export function buildAutomationDraftFromTurn(input: {
  userText: string
  assistantText?: string
  reason?: string
  timezone?: string
}): AutomationDraftSummary {
  const source = [input.userText, input.assistantText].filter(Boolean).join('\n')
  const schedule = inferSchedule(source)
  const detectedIntegrations = detectIntegrations(source)
  const missingFields: string[] = []
  if (!/\b(hourly|daily|weekly|monthly|every|morning|evening|night|at\s+\d)/i.test(source)) {
    missingFields.push('Confirm schedule')
  }
  if (detectedIntegrations.length === 0) {
    missingFields.push('Confirm required integrations')
  }

  const name = inferTitle(input.userText)
  const pointerSteps = buildPointerSteps(input)
  return {
    name,
    description: clip(input.reason || `Scheduled automation that performs: ${name}`, 140),
    instructions: pointerSteps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
    graphSource: buildGraphSourceFromSteps(pointerSteps),
    schedule,
    timezone: input.timezone || 'UTC',
    detectedIntegrations,
    missingFields,
    confidence: missingFields.length === 0 ? 'high' : detectedIntegrations.length > 0 ? 'medium' : 'low',
    reason: input.reason || 'This looks like a recurring or scheduled workflow.',
  }
}
