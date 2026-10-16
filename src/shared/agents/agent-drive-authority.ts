import type { AgentDriveScope } from './agent-drive-manifest'

export type AgentDriveAuthorityClaims = {
  actorUserId: string; agentId: string; environmentId: string; bindingId: string; runId: string; sessionId: string
  scope: AgentDriveScope; expiresAt: number
  execution?: { attemptId: string; generation: number }
}

type CurrentDriveRun = {
  actorUserId: string; runId: string; sessionId: string; bindingId: string; agentId: string; environmentId: string
  scope: AgentDriveAuthorityClaims['scope']; bindingEnabled: boolean; environmentRevoked: boolean
  actorIsMember: boolean; status: string; hardDeadlineAt: number; execution?: AgentDriveAuthorityClaims['execution']
}

function sameDriveScope(left: AgentDriveAuthorityClaims['scope'], right: AgentDriveAuthorityClaims['scope']): boolean {
  return left.workspaceId === right.workspaceId && left.kind === right.kind
    && (left.kind !== 'personal' || (right.kind === 'personal' && left.ownerUserId === right.ownerUserId))
}

function sameDriveExecution(claims: AgentDriveAuthorityClaims, current: CurrentDriveRun): boolean {
  return claims.actorUserId === current.actorUserId && claims.runId === current.runId && claims.sessionId === current.sessionId
    && claims.bindingId === current.bindingId && claims.agentId === current.agentId && claims.environmentId === current.environmentId
    && claims.execution?.attemptId === current.execution?.attemptId && claims.execution?.generation === current.execution?.generation
}

/** Signing is only the first gate. Every operation must re-read binding/scope, membership and run fencing. */
export function assertCurrentDriveRun(claims: AgentDriveAuthorityClaims, current: CurrentDriveRun, now = Date.now()): void {
  if (claims.expiresAt <= now || current.hardDeadlineAt <= now || claims.expiresAt > current.hardDeadlineAt
    || !current.bindingEnabled || current.environmentRevoked || !current.actorIsMember
    || !['starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recovering', 'finalizing'].includes(current.status)
    || !sameDriveScope(claims.scope, current.scope) || !sameDriveExecution(claims, current)) {
    throw Error('DRIVE_RUN_UNAVAILABLE')
  }
}
