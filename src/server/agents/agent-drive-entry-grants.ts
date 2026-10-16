import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { agentDriveAuthorityArgs, type AgentDriveAuthorityClaims } from '@/shared/agents/agent-drive-authority'
import type { DriveMetadataEntry } from './agent-drive-metadata'

export function driveMetadataMac(secret: string, claims: AgentDriveAuthorityClaims, entry: DriveMetadataEntry): Buffer {
  const authority = createHash('sha256').update(JSON.stringify(agentDriveAuthorityArgs(claims))).digest('hex')
  return createHmac('sha256', secret).update('overlay-agent-drive-metadata:v1.').update(authority).update(JSON.stringify(entry)).digest()
}
export function verifyDriveMetadataMac(secret: string, claims: AgentDriveAuthorityClaims, entry: DriveMetadataEntry, encoded: string): void {
  const actual = Buffer.from(encoded, 'base64url')
  const expected = driveMetadataMac(secret, claims, entry)
  if (actual.toString('base64url') !== encoded || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error('DRIVE_INVALID_METADATA')
}
