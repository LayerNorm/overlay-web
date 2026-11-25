/** Workspace and Personal mockup: which version is on screen, the viewer's chief's name and the one-way moves made. */
import { notifyFixtures } from '../../fixtures/convex'

const params = new URLSearchParams(globalThis.location?.search ?? '')

/** "today" is the app as it is now; "proposed" is the app once P2–P7 have shipped. */
export type Mode = 'today' | 'proposed'
export const MODE: Mode = params.get('mode') === 'today' ? 'today' : 'proposed'
export const PROPOSED = MODE === 'proposed'

/** P3: the personal chief is "{Name}'s Chief", not a second "Overlay". */
export const PERSONAL_CHIEF_NAME = 'Mercedes’s Chief'

export function reloadWith(key: string, value: string) {
  const query = new URLSearchParams(globalThis.location.search)
  query.set(key, value)
  globalThis.location.href = `${globalThis.location.pathname}?${query.toString()}${globalThis.location.hash}`
}

/** Items moved to Workspace during this visit (moves are one-way, so nothing ever leaves this set). */
export const moved = new Set<string>()
export function markMoved(...ids: string[]) {
  for (const id of ids) moved.add(id)
  notifyFixtures()
}

type ModeAgent = { id: string; visibility?: string; agentRole?: string; createdByPrincipalId?: string }

const isCreatorOnly = (agent: ModeAgent) => !moved.has(agent.id) && (agent.visibility === 'creator' || agent.visibility === 'private')

/**
 * P2/P3: Workspace mode lists the workspace Overlay and every workspace-visible agent. Personal mode lists only the
 * viewer's Personal Chief and their creator-only agents. The Personal Chief never appears in Workspace mode.
 */
export function agentsForMode<T extends ModeAgent>(agents: T[], viewerPrincipalId: string | null | undefined, mode: 'personal' | 'workspace'): T[] {
  return agents.filter((agent) => {
    if (agent.agentRole === 'workspace_chief') return mode === 'workspace'
    if (agent.agentRole === 'personal_chief') return mode === 'personal' && agent.createdByPrincipalId === viewerPrincipalId
    if (mode === 'workspace') return !isCreatorOnly(agent)
    return isCreatorOnly(agent) && agent.createdByPrincipalId === viewerPrincipalId
  })
}
