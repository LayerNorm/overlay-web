import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { AgentDriveAuthorityClaims } from '@/shared/agents/agent-drive-authority'
import type { DriveMetadataEntry } from './agent-drive-metadata'

/** Renewal changes credential expiry, never the execution or resource authority. */
export function driveGrantAuthorityHash(claims: AgentDriveAuthorityClaims): string {
  return createHash('sha256').update(JSON.stringify([
    claims.actorUserId, claims.agentId, claims.environmentId, claims.bindingId, claims.runId, claims.sessionId,
    claims.scope.workspaceId, claims.scope.kind, claims.scope.kind === 'personal' ? claims.scope.ownerUserId : null,
    claims.execution ? [claims.execution.attemptId, claims.execution.generation] : null,
  ])).digest('hex')
}

export function driveMetadataMac(secret: string, claims: AgentDriveAuthorityClaims, entry: DriveMetadataEntry): Buffer {
  return createHmac('sha256', secret).update('overlay-agent-drive-metadata:v2.').update(driveGrantAuthorityHash(claims)).update(JSON.stringify(entry)).digest()
}
export function verifyDriveMetadataMac(secret: string, claims: AgentDriveAuthorityClaims, entry: DriveMetadataEntry, encoded: string): void {
  const actual = Buffer.from(encoded, 'base64url')
  const expected = driveMetadataMac(secret, claims, entry)
  if (actual.toString('base64url') !== encoded || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error('DRIVE_INVALID_METADATA')
}
