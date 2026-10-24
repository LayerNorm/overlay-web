export type AgentMcpExecutionAuthority = {
  workspaceId: string; environmentId: string; runId: string; sessionId?: string; expiresAt?: number
  execution?: { attemptId: string; generation: number }
}
type SessionAuthority = {
  id: string; workspaceId: string; environmentId: string; runId: string; status: string
  attemptId?: string; executionGeneration?: number; hardDeadlineAt?: number; endedAt?: number
}
const LIVE_SESSION_STATUSES = new Set(['starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recovering'])

/** Older signed grants work only before a first execution has ever been replaced. */
export function agentMcpAttemptMatches(claims: AgentMcpExecutionAuthority, session: SessionAuthority | null): boolean {
  if (!session || session.workspaceId !== claims.workspaceId || session.environmentId !== claims.environmentId || session.runId !== claims.runId) return false
  if (claims.sessionId !== undefined && claims.sessionId !== session.id) return false
  if (session.attemptId === undefined && session.executionGeneration === undefined) return claims.execution === undefined
  if (session.attemptId !== session.id) return false
  if (!claims.execution) return session.executionGeneration === 1
  return claims.sessionId === session.id && claims.execution.attemptId === session.attemptId
    && claims.execution.generation === session.executionGeneration
}

export function agentMcpSessionIsLive(claims: AgentMcpExecutionAuthority, session: SessionAuthority | null, now = Date.now()): boolean {
  if (!session || !agentMcpAttemptMatches(claims, session) || session.endedAt !== undefined || !LIVE_SESSION_STATUSES.has(session.status)
    || (claims.expiresAt !== undefined && claims.expiresAt <= now)) return false
  return session.attemptId === undefined || (typeof session.hardDeadlineAt === 'number' && now < session.hardDeadlineAt)
}
