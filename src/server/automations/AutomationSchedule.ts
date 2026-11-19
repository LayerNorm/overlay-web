import type { AutomationSchedule } from '@overlay/app-core'
import { computeNextRunAt, DEFAULT_SCHEDULE, normalizeSchedule } from '@/shared/automations/schedule'

export const DEFAULT_AUTOMATION_SCHEDULE: AutomationSchedule = DEFAULT_SCHEDULE

export function normalizeAutomationSchedule(schedule: AutomationSchedule): AutomationSchedule {
  return normalizeSchedule(schedule)
}

export function computeNextAutomationRunAt(scheduleInput: AutomationSchedule, fromMs: number, timeZone?: string): number {
  return computeNextRunAt(scheduleInput, fromMs, timeZone)
}
