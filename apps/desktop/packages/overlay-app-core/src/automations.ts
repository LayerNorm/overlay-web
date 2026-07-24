import type { AutomationSchedule, AutomationSummary } from './contracts'

export const AUTOMATIONS_UPDATED_EVENT = 'overlay:automations-updated'

export type AutomationDetail = AutomationSummary
export type AutomationDetailTab = 'chat' | 'edit'
export type AutomationSaveState = 'idle' | 'saving' | 'saved' | 'error'
export type AutomationTestState = 'idle' | 'running' | 'success' | 'error'
export const MIN_AUTOMATION_INTERVAL_MINUTES = 15

export interface AutomationTimeZoneOption {
  label: string
  offsetMinutes: number
  value: string
}

export interface AutomationLocalScheduleFields {
  time: string
  dayOfWeek: number
  dayOfMonth: number
}

export interface AutomationEditorDraft {
  name: string
  description: string
  instructions: string
  enabled: boolean
  scheduleKind: AutomationSchedule['kind']
  intervalMinutes: number
  timezone: string
  time: string
  dayOfWeek: number
  dayOfMonth: number
  graphSource: string
  modelId: string
}

export interface CreateAutomationRequest {
  accessToken?: string
  userId?: string
  name?: string
  description?: string
  instructions?: string
  enabled?: boolean
  schedule?: AutomationSchedule
  timezone?: string
  projectId?: string
  modelId?: string
  graphSource?: string
  sourceConversationId?: string
  concurrencyPolicy?: 'skip' | 'queue'
}

export interface CreateAutomationResponse {
  success: boolean
  id?: string
  error?: string
}

export interface UpdateAutomationRequest {
  accessToken?: string
  userId?: string
  automationId: string
  action?: 'cancel-run' | 'pause' | 'resume' | 'retry-run'
  runId?: string
  name?: string
  description?: string
  instructions?: string
  enabled?: boolean
  schedule?: AutomationSchedule
  timezone?: string
  projectId?: string
  modelId?: string
  graphSource?: string
  concurrencyPolicy?: 'skip' | 'queue'
}

export interface DeleteAutomationResponse {
  success?: boolean
  linkedConversationIds?: string[]
  error?: string
}

export interface AutomationRunRequest {
  runId: string
}

export interface AutomationRunResponse {
  success?: boolean
  conversationId?: string
  error?: string
  message?: string
}

export interface AutomationTestRequest {
  accessToken?: string
  userId?: string
  automationId: string
}

export interface AutomationTestResponse {
  success?: boolean
  runId?: string
  conversationId?: string
  error?: string
  message?: string
}

const FALLBACK_TIME_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
]

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export function normalizeAutomationDetailTab(value: string | null | undefined): AutomationDetailTab {
  return value === 'edit' || value === 'graph' ? 'edit' : 'chat'
}

export function getAutomationDisplayName(automation: Pick<AutomationSummary, 'name' | 'title'>): string {
  return automation.name || automation.title || 'Untitled automation'
}

export function getAutomationInstructions(
  automation: Pick<AutomationSummary, 'instructions' | 'instructionsMarkdown'>,
): string {
  return automation.instructions || automation.instructionsMarkdown || ''
}

export function getAutomationConversationId(
  automation: Pick<AutomationSummary, 'sourceConversationId' | 'conversationId'>,
): string | undefined {
  return automation.sourceConversationId || automation.conversationId
}

export function automationHref(automation: Pick<AutomationSummary, '_id' | 'sourceConversationId' | 'conversationId'>): string {
  const conversationId = getAutomationConversationId(automation)
  return conversationId
    ? `/app/automations?id=${encodeURIComponent(conversationId)}&automationId=${encodeURIComponent(automation._id)}`
    : `/app/automations?automationId=${encodeURIComponent(automation._id)}`
}

export function automationStatus(automation: Pick<AutomationSummary, 'enabled' | 'lastError'>): {
  label: string
  tone: 'error' | 'enabled' | 'paused'
} {
  if (automation.lastError) return { label: 'Error', tone: 'error' }
  return automation.enabled !== false
    ? { label: 'Enabled', tone: 'enabled' }
    : { label: 'Paused', tone: 'paused' }
}

export function applyAutomationRename<T extends Pick<AutomationSummary, '_id' | 'name'>>(
  automations: readonly T[],
  automationId: string,
  name: string,
): T[] {
  return automations.map((automation) => (
    automation._id === automationId ? { ...automation, name } : automation
  ))
}

export function removeAutomationById<T extends Pick<AutomationSummary, '_id'>>(
  automations: readonly T[],
  automationId: string,
): T[] {
  return automations.filter((automation) => automation._id !== automationId)
}

function mermaidLabel(value: string): string {
  return value.replace(/["\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function extractAutomationInstructionSteps(instructions: string): string[] {
  const lines = instructions.split('\n')
  const numbered = lines
    .map((line) => line.trim().match(/^\d+\.\s+(.+)$/)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
  if (numbered.length > 0) return numbered.slice(0, 10)

  return lines
    .map((line) => line.trim().replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('```'))
    .slice(0, 8)
}

export function graphSourceFromAutomationInstructions(
  automation: Pick<AutomationSummary, 'instructions' | 'instructionsMarkdown'>,
): string {
  const steps = extractAutomationInstructionSteps(getAutomationInstructions(automation))
  if (steps.length === 0) return ''
  const nodes = steps.map((step, index) => {
    const nodeId = `step${index + 1}`
    const label = mermaidLabel(step).slice(0, 96)
    return `  ${nodeId}["${index + 1}. ${label}"]`
  })
  const edges = steps.slice(1).map((_, index) => `  step${index + 1} --> step${index + 2}`)
  return ['flowchart TD', ...nodes, ...edges].join('\n')
}

export function defaultAutomationGraphSource(
  automation: Pick<AutomationSummary, 'name' | 'title' | 'instructions' | 'instructionsMarkdown' | 'schedule' | 'modelId'>,
  defaultModelId = 'default',
): string {
  const instructionGraph = graphSourceFromAutomationInstructions(automation)
  if (instructionGraph) return instructionGraph
  const name = mermaidLabel(getAutomationDisplayName(automation))
  const schedule = automation.schedule?.kind ? automation.schedule.kind : 'schedule'
  const model = automation.modelId || defaultModelId
  return [
    'flowchart TD',
    `  trigger["${schedule} trigger"] --> instructions["${name} instructions"]`,
    `  instructions --> model["Run with ${model}"]`,
    '  model --> output["Write result to automation chat"]',
  ].join('\n')
}

function supportedTimeZones(): string[] {
  try {
    const values = Intl.supportedValuesOf?.('timeZone')
    return values?.length ? values : FALLBACK_TIME_ZONES
  } catch {
    return FALLBACK_TIME_ZONES
  }
}

function getTimeZoneParts(dateMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(dateMs))
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const weekday = read('weekday')
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')),
    minute: Number(read('minute')),
    dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday),
  }
}

function timeZoneOffsetMinutes(timeZone: string, dateMs = Date.now()): number {
  const minuteAlignedDateMs = Math.floor(dateMs / 60_000) * 60_000
  const parts = getTimeZoneParts(minuteAlignedDateMs, timeZone)
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  return Math.round((localAsUtc - minuteAlignedDateMs) / 60_000)
}

function formatGmtOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  return `GMT${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function timeZoneCityLabel(timeZone: string): string {
  const parts = timeZone.split('/')
  return (parts.at(-1) || timeZone).replaceAll('_', ' ')
}

export function supportedTimeZoneOptions(): AutomationTimeZoneOption[] {
  return supportedTimeZones()
    .map((value) => {
      const offsetMinutes = timeZoneOffsetMinutes(value)
      return {
        value,
        offsetMinutes,
        label: `${formatGmtOffset(offsetMinutes)} - ${timeZoneCityLabel(value)}`,
      }
    })
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label))
}

export function safeTimeZone(value: string | undefined): string {
  const zones = supportedTimeZones()
  const candidate = value?.trim()
  if (candidate && zones.includes(candidate)) return candidate
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function zonedDateTimeToUtcMs(input: {
  timeZone: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
}): number {
  const targetUtcLike = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0)
  let candidate = targetUtcLike
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = getTimeZoneParts(candidate, input.timeZone)
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0)
    candidate -= asUtc - targetUtcLike
  }
  return candidate
}

function utcReferenceForSchedule(schedule: AutomationSchedule | undefined, nowMs = Date.now()): number {
  const now = new Date(nowMs)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const baseDay = now.getUTCDate()
  const hour = schedule && 'hourUTC' in schedule ? schedule.hourUTC ?? 9 : 9
  const minute = schedule && 'minuteUTC' in schedule ? schedule.minuteUTC ?? 0 : 0
  if (schedule?.kind === 'weekly') {
    const sunday = baseDay - now.getUTCDay()
    return Date.UTC(year, month, sunday + (schedule.dayOfWeekUTC ?? 1), hour, minute)
  }
  if (schedule?.kind === 'monthly') {
    return Date.UTC(year, month, schedule.dayOfMonthUTC ?? 1, hour, minute)
  }
  return Date.UTC(year, month, baseDay, hour, minute)
}

export function localFieldsFromSchedule(
  schedule: AutomationSchedule | undefined,
  timeZone: string,
  nowMs = Date.now(),
): AutomationLocalScheduleFields {
  const parts = getTimeZoneParts(utcReferenceForSchedule(schedule, nowMs), timeZone)
  return {
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
    dayOfWeek: parts.dayOfWeek >= 0 ? parts.dayOfWeek : 1,
    dayOfMonth: Math.min(31, Math.max(1, parts.day || 1)),
  }
}

export function parseAutomationTime(value: string): { hour: number; minute: number } {
  const [hourRaw, minuteRaw] = value.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.floor(hour))) : 9,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, Math.floor(minute))) : 0,
  }
}

export function buildAutomationSchedule(input: {
  kind: AutomationSchedule['kind']
  intervalMinutes: number
  time: string
  dayOfWeek: number
  dayOfMonth: number
  timeZone: string
  nowMs?: number
}): AutomationSchedule {
  if (input.kind === 'interval') {
    return {
      kind: 'interval',
      intervalMinutes: Math.max(MIN_AUTOMATION_INTERVAL_MINUTES, Math.floor(input.intervalMinutes) || 60),
    }
  }
  const nowParts = getTimeZoneParts(input.nowMs ?? Date.now(), input.timeZone)
  const localTime = parseAutomationTime(input.time)
  let localYear = nowParts.year
  let localMonth = nowParts.month
  let localDay = nowParts.day
  if (input.kind === 'weekly') {
    const today = nowParts.dayOfWeek >= 0 ? nowParts.dayOfWeek : 0
    const target = Math.min(6, Math.max(0, Math.floor(input.dayOfWeek)))
    const offset = (target - today + 7) % 7
    const base = new Date(zonedDateTimeToUtcMs({
      timeZone: input.timeZone,
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour: 12,
      minute: 0,
    }))
    const candidate = getTimeZoneParts(base.getTime() + offset * 24 * 60 * 60_000, input.timeZone)
    localYear = candidate.year
    localMonth = candidate.month
    localDay = candidate.day
  } else if (input.kind === 'monthly') {
    localDay = Math.min(31, Math.max(1, Math.floor(input.dayOfMonth)))
  }
  const utc = new Date(zonedDateTimeToUtcMs({
    timeZone: input.timeZone,
    year: localYear,
    month: localMonth,
    day: localDay,
    hour: localTime.hour,
    minute: localTime.minute,
  }))
  if (input.kind === 'weekly') {
    return {
      kind: 'weekly',
      dayOfWeekUTC: utc.getUTCDay(),
      hourUTC: utc.getUTCHours(),
      minuteUTC: utc.getUTCMinutes(),
    }
  }
  if (input.kind === 'monthly') {
    return {
      kind: 'monthly',
      dayOfMonthUTC: utc.getUTCDate(),
      hourUTC: utc.getUTCHours(),
      minuteUTC: utc.getUTCMinutes(),
    }
  }
  return { kind: 'daily', hourUTC: utc.getUTCHours(), minuteUTC: utc.getUTCMinutes() }
}

export function automationEditorDraftFromDetail(
  automation: AutomationDetail,
  defaultModelId: string,
): AutomationEditorDraft {
  const schedule = automation.schedule ?? { kind: 'daily' as const, hourUTC: 14, minuteUTC: 0 }
  const timezone = safeTimeZone(automation.timezone)
  const localFields = localFieldsFromSchedule(schedule, timezone)
  return {
    name: getAutomationDisplayName(automation),
    description: automation.description ?? '',
    instructions: getAutomationInstructions(automation),
    enabled: automation.enabled ?? true,
    scheduleKind: schedule.kind,
    intervalMinutes: schedule.kind === 'interval' ? schedule.intervalMinutes ?? 60 : 60,
    timezone,
    time: localFields.time,
    dayOfWeek: localFields.dayOfWeek,
    dayOfMonth: localFields.dayOfMonth,
    graphSource: automation.graphSource || defaultAutomationGraphSource(automation, defaultModelId),
    modelId: automation.modelId ?? defaultModelId,
  }
}

export function buildAutomationUpdateRequest(input: {
  automation: AutomationDetail
  draft: AutomationEditorDraft
}): UpdateAutomationRequest {
  const instructionsChanged = input.draft.instructions.trim() !== getAutomationInstructions(input.automation).trim()
  const graphSource = instructionsChanged
    ? graphSourceFromAutomationInstructions({ ...input.automation, instructions: input.draft.instructions }) ||
      defaultAutomationGraphSource({ ...input.automation, instructions: input.draft.instructions, modelId: input.draft.modelId })
    : input.draft.graphSource
  return {
    automationId: input.automation._id,
    name: input.draft.name,
    description: input.draft.description,
    instructions: input.draft.instructions,
    enabled: input.draft.enabled,
    schedule: buildAutomationSchedule({
      kind: input.draft.scheduleKind,
      intervalMinutes: input.draft.intervalMinutes,
      time: input.draft.time,
      dayOfWeek: input.draft.dayOfWeek,
      dayOfMonth: input.draft.dayOfMonth,
      timeZone: input.draft.timezone,
    }),
    timezone: input.draft.timezone,
    graphSource,
    modelId: input.draft.modelId,
  }
}

export function applyAutomationUpdate(
  automation: AutomationDetail,
  request: UpdateAutomationRequest,
): AutomationDetail {
  return {
    ...automation,
    name: request.name?.trim() ?? automation.name,
    description: request.description?.trim() ?? automation.description,
    instructions: request.instructions?.trim() ?? automation.instructions,
    enabled: request.enabled ?? automation.enabled,
    schedule: request.schedule ?? automation.schedule,
    timezone: request.timezone ?? automation.timezone,
    graphSource: request.graphSource ?? automation.graphSource,
    modelId: request.modelId ?? automation.modelId,
  }
}
