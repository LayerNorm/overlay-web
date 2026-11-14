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

function buildPointerSteps(input: { userText: string; assistantText?: string }, integrationConflict = false): string[] {
  if (integrationConflict) return ['Clarify whether the workflow should use an integration']

  const assistantLines = (input.assistantText || '')
    .split('\n')
    .map((line) => line.trim().replace(/^(?:[-*]\s+|\d+[.)]\s+)/, '').trim())
    .filter((line) => line.length > 0)

  if (assistantLines.length > 0 && hasClearWorkflow(assistantLines)) return assistantLines

  const source = [input.userText, input.assistantText].filter(Boolean).join('\n')
  const normalized = source.toLowerCase()
  const asksForNewsDigest = /\b(news|digest|headlines)\b/.test(normalized) && /\b(email|gmail|send)\b/.test(normalized)

  if (asksForNewsDigest && !hasExplicitNoIntegrations(input.userText)) {
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

  return ['Clarify what this automation should do']
}

function hasClearWorkflow(lines: string[]): boolean {
  const remaining = lines.join(' ')
    .replace(/\b(?:sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|and|or|a|an|the|this|automation|workflow|schedule|scheduled|daily|weekly|monthly|quarterly|yearly|annually|hourly|every|each|day|week|month|first|second|third|last|on|at|of|for|that|is|runs?|will|utc|integration|integrations|required|needed|none|no|not|do|does|need|needs)\b/gi, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z0-9]/gi, ' ')
    .trim()
  return remaining.length > 0
}

function hasExplicitNoIntegrations(text: string): boolean {
  return /\b(?:no|without)\s+(?:any\s+)?(?:external\s+)?integrations?\b/i.test(text)
}

function mentionsLinearIntegration(text: string): boolean {
  return (
    /\blinear\s+(?:issues?|tasks?|projects?|teams?|workspaces?|cycles?|tickets?|comments?|boards?)\b/i.test(text) ||
    /\b(?:use|using)\s+linear\s+(?:to|for)\s+(?:create|open|update|add|search|find|send|post|sync|assign|move|track|manage)\b/i.test(text) ||
    /(?:^|[.!?;,:]\s*)[a-z][a-z'-]*\s+linear\s+for\s+[a-z]/i.test(text) ||
    /\b(?:use|using|via|through|in|to|from|with|except|including|only)\s+linear(?=\s*(?:[.!?;,:]|$))/i.test(text)
  )
}

function detectIntegrations(text: string): string[] {
  const normalized = text.toLowerCase()
  return KNOWN_INTEGRATIONS.filter((name) =>
    name === 'Linear' ? mentionsLinearIntegration(text) : normalized.includes(name.toLowerCase()),
  )
}

type ParsedValue<T> =
  | { status: 'absent' }
  | { status: 'value'; value: T }
  | { status: 'invalid'; missingField: string }

type ScheduleCadence =
  | { kind: 'interval'; intervalMinutes: number }
  | { kind: 'daily' }
  | { kind: 'weekly' }
  | { kind: 'monthly' }

type ClockTime = { hour: number; minute: number }

function preferUserValue<T>(user: ParsedValue<T>, assistant: ParsedValue<T>): ParsedValue<T> {
  return user.status === 'absent' ? assistant : user
}

function containsWeekday(text: string): boolean {
  return /\b(?:sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?)\b/i.test(text)
}

function containsDailyCadence(text: string): boolean {
  return (
    /\bevery day\b/i.test(text) ||
    /\bdaily(?=\s*(?:at|and|or|starting|from|automations?|schedules?|workflows?)\b|[,.!?;:]|$)/i.test(text) ||
    /\b(?:run|runs|repeat|repeats|schedule|scheduled|execute|executes)\s+(?:it\s+)?daily\b/i.test(text)
  )
}

function parseCadence(text: string): ParsedValue<ScheduleCadence> {
  const intervalMatches = [...text.matchAll(/\bevery\s+(\d+)\s+minutes?\b/gi)]
  const hourly = /\b(?:hourly|every hour)\b/i.test(text)
  const monthly = /\bmonthly\b|\b(?:every|each)\s+month\b/i.test(text)
  const weekly = /\bweekly\b|\bevery week\b/i.test(text) || containsWeekday(text)
  const daily = containsDailyCadence(text)
  const unsupported = /\b(?:quarterly|every quarter|annual(?:ly)?|yearly|every year|every\s+\d+\s+(?:hours?|days?|weeks?|months?)|every other\s+(?:day|week|month)|biweekly|fortnightly)\b/i.test(text)
  const kinds = [
    ...(hourly || intervalMatches.length > 0 ? ['interval'] : []),
    ...(daily ? ['daily'] : []),
    ...(weekly ? ['weekly'] : []),
    ...(monthly ? ['monthly'] : []),
  ]

  if (unsupported) return { status: 'invalid', missingField: 'Confirm supported schedule frequency' }
  if (kinds.length === 0) return { status: 'absent' }
  if (kinds.length > 1) return { status: 'invalid', missingField: 'Confirm schedule frequency' }
  if (kinds[0] === 'interval') {
    const values = [
      ...(hourly ? [60] : []),
      ...intervalMatches.map((match) => Number(match[1])),
    ]
    if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 24 * 60)) {
      return { status: 'invalid', missingField: 'Confirm interval between 1 and 1440 minutes' }
    }
    const uniqueValues = [...new Set(values)]
    if (uniqueValues.length > 1) {
      return { status: 'invalid', missingField: 'Confirm one schedule interval' }
    }
    return { status: 'value', value: { kind: 'interval', intervalMinutes: uniqueValues[0] ?? 60 } }
  }
  if (kinds[0] === 'daily') return { status: 'value', value: { kind: 'daily' } }
  if (kinds[0] === 'weekly') return { status: 'value', value: { kind: 'weekly' } }
  return { status: 'value', value: { kind: 'monthly' } }
}

function parseUtcTime(text: string): ParsedValue<ClockTime> {
  const matches = [...text.matchAll(/(^|[^\w])([+-]?\d+):([+-]?\d+)(?!\w)/g)]
  if (matches.length === 0) {
    if (/\b(?:morning|evening|night|noon|midnight)\b|\b(?:at\s+)?[+-]?\d+\s*(?:a\.?m\.?|p\.?m\.?)\b|\bat\s+[+-]?\d+\b/i.test(text)) {
      return { status: 'invalid', missingField: 'Confirm schedule time in UTC' }
    }
    return { status: 'absent' }
  }

  const values: ClockTime[] = []
  for (const match of matches) {
    const index = match.index ?? 0
    const timezone = text.slice(index + match[0].length).match(/^\s*UTC\b(?!\s*[+-])/i)
    if (!timezone) return { status: 'invalid', missingField: 'Confirm schedule time in UTC' }
    const rawHour = match[2]!
    const rawMinute = match[3]!
    if (!/^\d{1,2}$/.test(rawHour) || !/^\d{2}$/.test(rawMinute)) {
      return { status: 'invalid', missingField: 'Confirm valid UTC time (HH:mm)' }
    }
    const hour = Number(rawHour)
    const minute = Number(rawMinute)
    if (hour > 23 || minute > 59) {
      return { status: 'invalid', missingField: 'Confirm valid UTC time (HH:mm)' }
    }
    values.push({ hour, minute })
  }

  const uniqueValues = [...new Map(values.map((value) => [`${value.hour}:${value.minute}`, value])).values()]
  if (uniqueValues.length > 1) {
    return { status: 'invalid', missingField: 'Confirm one UTC schedule time' }
  }
  return { status: 'value', value: uniqueValues[0]! }
}

function parseMonthlyDay(text: string): ParsedValue<number> {
  const days: string[] = []
  for (const match of text.matchAll(/\bday\s+([+-]?\d+)(?:st|nd|rd|th)?\b/gi)) {
    days.push(match[1]!)
  }
  for (const match of text.matchAll(/(^|[^\w])([+-]?\d+)(?:st|nd|rd|th)\s+(?:day\b|(?:of\s+)?(?:each|every|the)\s+month\b)/gi)) {
    days.push(match[2]!)
  }
  for (const match of text.matchAll(/\b(first|second|third)\s+(?:day\b|(?:of\s+)?(?:each|every|the)\s+month\b)/gi)) {
    days.push(String({ first: 1, second: 2, third: 3 }[match[1]!.toLowerCase() as 'first' | 'second' | 'third']))
  }

  if (days.length === 0) {
    return /\b(?:last|first|second|third)\s+day\b/i.test(text)
      ? { status: 'invalid', missingField: 'Confirm monthly day (1-31)' }
      : { status: 'absent' }
  }
  const values = days.map(Number)
  if (days.some((day, index) => !/^\d{1,2}$/.test(day) || values[index]! < 1 || values[index]! > 31)) {
    return { status: 'invalid', missingField: 'Confirm valid monthly day (1-31)' }
  }
  if (new Set(values).size > 1) {
    return { status: 'invalid', missingField: 'Confirm one monthly day' }
  }
  return { status: 'value', value: values[0]! }
}

function parseWeekday(text: string): ParsedValue<number> {
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const found = weekdays.flatMap((day, index) => new RegExp(`\\b${day}s?\\b`, 'i').test(text) ? [index] : [])
  if (found.length === 0) return { status: 'absent' }
  if (found.length > 1) return { status: 'invalid', missingField: 'Confirm one weekday' }
  return { status: 'value', value: found[0]! }
}

function inferSchedule(userText: string, assistantText = ''): { schedule: AutomationScheduleDraft; missingFields: string[] } {
  const cadence = preferUserValue(parseCadence(userText), parseCadence(assistantText))
  const missingFields: string[] = []
  const time = preferUserValue(parseUtcTime(userText), parseUtcTime(assistantText))
  const clock = time.status === 'value' ? time.value : { hour: 14, minute: 0 }

  if (cadence.status === 'invalid') {
    missingFields.push(cadence.missingField)
  } else if (cadence.status === 'absent') {
    missingFields.push('Confirm schedule frequency')
  }

  if (cadence.status === 'value' && cadence.value.kind === 'interval') {
    return { schedule: cadence.value, missingFields }
  }

  if (time.status === 'invalid') {
    missingFields.push(time.missingField)
  } else if (time.status === 'absent') {
    missingFields.push('Confirm schedule time in UTC')
  }

  if (cadence.status !== 'value') {
    return { schedule: { kind: 'daily', hourUTC: clock.hour, minuteUTC: clock.minute }, missingFields }
  }

  if (cadence.value.kind === 'monthly') {
    const day = preferUserValue(parseMonthlyDay(userText), parseMonthlyDay(assistantText))
    if (day.status === 'invalid') missingFields.push(day.missingField)
    else if (day.status === 'absent') missingFields.push('Confirm monthly day')
    return {
      schedule: {
        kind: 'monthly',
        dayOfMonthUTC: day.status === 'value' ? day.value : 1,
        hourUTC: clock.hour,
        minuteUTC: clock.minute,
      },
      missingFields,
    }
  }

  if (cadence.value.kind === 'weekly') {
    const weekday = preferUserValue(parseWeekday(userText), parseWeekday(assistantText))
    if (weekday.status === 'invalid') missingFields.push(weekday.missingField)
    else if (weekday.status === 'absent') missingFields.push('Confirm weekday')
    return {
      schedule: {
        kind: 'weekly',
        dayOfWeekUTC: weekday.status === 'value' ? weekday.value : 1,
        hourUTC: clock.hour,
        minuteUTC: clock.minute,
      },
      missingFields,
    }
  }

  return { schedule: { kind: 'daily', hourUTC: clock.hour, minuteUTC: clock.minute }, missingFields }
}

export function buildAutomationDraftFromTurn(input: {
  userText: string
  assistantText?: string
  reason?: string
  timezone?: string
}): AutomationDraftSummary {
  const source = [input.userText, input.assistantText].filter(Boolean).join('\n')
  const inferred = inferSchedule(input.userText, input.assistantText)
  const explicitNoIntegrations = hasExplicitNoIntegrations(input.userText)
  const integrationConflict =
    explicitNoIntegrations &&
    (detectIntegrations(input.userText).length > 0 || detectIntegrations(input.assistantText || '').length > 0)
  const detectedIntegrations = explicitNoIntegrations ? [] : detectIntegrations(source)
  const missingFields = [...inferred.missingFields]
  if (integrationConflict) {
    missingFields.push('Resolve conflicting integration instructions')
  }
  if (!explicitNoIntegrations && detectedIntegrations.length === 0) {
    missingFields.push('Confirm required integrations')
  }

  const name = inferTitle(input.userText)
  const pointerSteps = buildPointerSteps(input, integrationConflict)
  if (pointerSteps[0] === 'Clarify what this automation should do') {
    missingFields.push('Clarify automation instructions')
  }
  return {
    name,
    description: clip(input.reason || `Scheduled automation that performs: ${name}`, 140),
    instructions: pointerSteps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
    graphSource: buildGraphSourceFromSteps(pointerSteps),
    schedule: inferred.schedule,
    timezone: input.timezone || 'UTC',
    detectedIntegrations,
    missingFields,
    confidence:
      missingFields.length === 0
        ? 'high'
        : inferred.missingFields.length > 0 || integrationConflict || detectedIntegrations.length === 0
          ? 'low'
          : 'medium',
    reason: input.reason || 'This looks like a recurring or scheduled workflow.',
  }
}
