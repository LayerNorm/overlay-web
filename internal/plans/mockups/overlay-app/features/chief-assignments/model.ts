/** Sample assignments for the Chief assignments mockup: each one belongs to the response that made it. */
const id = (slug: string) => `k17conv${slug}`.padEnd(32, '0')
export const CHIEF_THREAD_ID = id('chiefdrugdiscovery')
export const CHANNEL_ID = 'k17convchannellaunch000000000000'
export const DM_ID = 'k17convdmsam00000000000000000000'

/** "today" shows the app as it is now; "proposed" shows the requested changes. */
export type Mode = 'today' | 'proposed'
const params = new URLSearchParams(globalThis.location?.search ?? '')
export const MODE: Mode = params.get('mode') === 'today' ? 'today' : 'proposed'
export function switchMode(mode: Mode) {
  const query = new URLSearchParams(globalThis.location.search)
  query.set('mode', mode)
  globalThis.location.href = `${globalThis.location.pathname}?${query.toString()}${globalThis.location.hash}`
}

export type AssignmentStatus = 'running' | 'completed' | 'failed' | 'waiting_for_input'
export type Assignment = {
  assignmentId: string
  conversationId: string
  /** The response that made this assignment. */
  messageId: string
  title: string
  agentName: string
  agentId?: string
  threadId?: string
  status: AssignmentStatus
  /** Plain-language reason, shown only when the assignment did not run or did not finish. */
  reason?: string
  /** What the person can do about it. */
  actions?: string[]
  when: string
}

export const ASSIGNMENTS: Assignment[] = []
export const assignmentsForMessage = (messageId: string) => ASSIGNMENTS.filter((item) => item.messageId === messageId)
export const assignmentsForConversation = (conversationId: string) => ASSIGNMENTS.filter((item) => item.conversationId === conversationId)
export const conversationInHref = (href: string) => [CHIEF_THREAD_ID, CHANNEL_ID, DM_ID].find((entry) => href.includes(entry)) ?? null
