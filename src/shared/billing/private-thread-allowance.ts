/**
 * The free tier for private threads (internal/plans/LOCAL_PRIVATE_THREADS_PLAN.md, Decision 4).
 *
 * A private thread runs its agent loop and model calls on the person's own computer, so Overlay runs no inference
 * for it. In a workspace without a paid plan that has only the one member, its Overlay tools are limited to the
 * groups below, and web searches are counted per person per calendar month (UTC). Storage is the person's free
 * storage amount (`FREE_PLAN_STORAGE_BYTES`). A paid workspace gets the agent's whole grant, charged as usual.
 */
import { toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'

/** Tool groups a private thread may use without a paid plan. Everything else (computers, media, automations, connected apps, MCP servers, asking agents) is paid. */
export const PRIVATE_THREAD_FREE_TOOL_GROUP_IDS = ['memory', 'files', 'tasks', 'skills', 'web_search'] as const

export const PRIVATE_THREAD_FREE_WEB_SEARCHES_PER_MONTH = 50

export type PrivateThreadAllowanceResource = 'web_search'

export const PRIVATE_THREAD_ALLOWANCE_LIMITS: Record<PrivateThreadAllowanceResource, number> = {
  web_search: PRIVATE_THREAD_FREE_WEB_SEARCHES_PER_MONTH,
}

/** The agent's grant, narrowed to what the free tier includes. */
export function privateThreadFreeGrant(agentGrantToolIds: readonly string[]): string[] {
  const free = new Set(toolIdsForEnabledGroups(new Set(PRIVATE_THREAD_FREE_TOOL_GROUP_IDS)))
  return agentGrantToolIds.filter((id) => free.has(id))
}

/** `2026-11`: the calendar month (UTC) a use is counted in. */
export function allowancePeriod(now: number): string {
  const date = new Date(now)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export const PRIVATE_THREAD_ALLOWANCE_MESSAGES = {
  web_search: `You've used this month's ${PRIVATE_THREAD_FREE_WEB_SEARCHES_PER_MONTH} free web searches. ` +
    'Upgrade the workspace to keep searching, or carry on without web search.',
} satisfies Record<PrivateThreadAllowanceResource, string>
