import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const id = z.string().min(1).max(200)
const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('personal'), workspaceId: id, ownerUserId: id }).strict(),
  z.object({ kind: z.literal('workspace'), workspaceId: id }).strict(),
])
const claimsSchema = z.object({
  version: z.literal(1), audience: z.literal('overlay-agent-drive'),
  actorUserId: id, agentId: id, environmentId: id, bindingId: id, runId: id, sessionId: id,
  scope: scopeSchema,
  execution: z.object({ attemptId: id, generation: z.number().int().nonnegative() }).strict().optional(),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
}).strict()
export type AgentDriveTokenClaims = z.infer<typeof claimsSchema>
type DriveTokenInput = Omit<AgentDriveTokenClaims, 'version' | 'audience' | 'issuedAt' | 'expiresAt'>
const MAX_LIFETIME_MS = 60 * 60_000
const PREFIX = 'ovdrive_'
const DOMAIN = 'overlay-agent-drive:v1.'

/** Separate purpose/signature domain from provider, host and MCP credentials. No storage keys. */
export function createAgentDriveTokens(options: { secret: string; now?: () => number }) {
  if (options.secret.trim().length < 32) throw Error('DRIVE_SIGNING_SECRET_UNAVAILABLE')
  const now = options.now ?? Date.now
  const signature = (payload: string) => createHmac('sha256', options.secret).update(DOMAIN + payload).digest()
  return {
    mint(input: DriveTokenInput, hardDeadlineAt: number): string {
      const issuedAt = now()
      if (!Number.isSafeInteger(hardDeadlineAt) || hardDeadlineAt <= issuedAt) throw Error('DRIVE_RUN_EXPIRED')
      const claims = claimsSchema.parse({ ...input, version: 1, audience: 'overlay-agent-drive', issuedAt,
        expiresAt: Math.min(hardDeadlineAt, issuedAt + MAX_LIFETIME_MS) })
      if (claims.scope.kind === 'personal' && claims.actorUserId !== claims.scope.ownerUserId) throw Error('DRIVE_PERSONAL_OWNER_MISMATCH')
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      return `${PREFIX}${payload}.${signature(payload).toString('base64url')}`
    },
    verify(token: string | null | undefined): AgentDriveTokenClaims | null {
      if (!token?.startsWith(PREFIX) || token.length > 8192) return null
      const parts = token.slice(PREFIX.length).split('.')
      if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null
      const [payload, mac] = parts
      const actual = Buffer.from(mac!, 'base64url'), expected = signature(payload!)
      if (actual.toString('base64url') !== mac || Buffer.from(payload!, 'base64url').toString('base64url') !== payload) return null
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
      try {
        const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')))
        const clock = now()
        if (claims.issuedAt > clock || claims.expiresAt <= clock || claims.expiresAt <= claims.issuedAt
          || claims.expiresAt - claims.issuedAt > MAX_LIFETIME_MS) return null
        if (claims.scope.kind === 'personal' && claims.actorUserId !== claims.scope.ownerUserId) return null
        return claims
      } catch (_error) { return null }
    },
  }
}

export { assertCurrentDriveRun } from '@/shared/agents/agent-drive-authority'
