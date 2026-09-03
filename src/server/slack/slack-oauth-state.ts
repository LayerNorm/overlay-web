import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

const STATE_TTL_MS = 10 * 60 * 1_000

/**
 * Signed OAuth `state` for platform installs. The installing manager mints it
 * through the authenticated install route; the unauthenticated OAuth callback
 * verifies it. The signature is the authorization — no session is needed at
 * callback time, and the short TTL bounds replay.
 */
export function signInstallState(args: {
  workspaceId: string
  principalId: string
  directory: string
  secret: string
  now?: number
}): string {
  const now = args.now ?? Date.now()
  const body = Buffer.from(JSON.stringify({
    workspaceId: args.workspaceId.trim(),
    principalId: args.principalId.trim(),
    directory: args.directory.trim(),
    exp: now + STATE_TTL_MS,
  })).toString('base64url')
  const signature = createHmac('sha256', args.secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifyInstallState(args: {
  state: string
  secret: string
  now?: number
}): { workspaceId: string; principalId: string; directory: string } {
  const invalid = new Error('PLATFORM_INSTALL_STATE_INVALID')
  const [body, signature] = args.state.split('.')
  if (!body || !signature) throw invalid
  const expected = createHmac('sha256', args.secret).update(body).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid
  let parsed: { workspaceId?: unknown; principalId?: unknown; directory?: unknown; exp?: unknown }
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as typeof parsed
  } catch (_error) {
    void _error
    throw invalid
  }
  if (typeof parsed.workspaceId !== 'string' || !parsed.workspaceId.trim()
    || typeof parsed.principalId !== 'string' || !parsed.principalId.trim()
    || typeof parsed.directory !== 'string' || !parsed.directory.trim()
    || typeof parsed.exp !== 'number' || parsed.exp <= (args.now ?? Date.now())) throw invalid
  return {
    workspaceId: parsed.workspaceId.trim(),
    principalId: parsed.principalId.trim(),
    directory: parsed.directory.trim(),
  }
}
