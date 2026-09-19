import 'server-only'

import { Sandbox } from '@vercel/sandbox'
import { logger } from '@/server/observability/logger'

/**
 * Orphan sweeper for `POST /api/v1/sandbox/run` sandboxes.
 *
 * The handler stops and deletes its sandbox in `finally`, and Vercel's own
 * `timeout` caps a runaway VM — but an aborted request can leave the record
 * behind. Ephemeral sandboxes are named `overlay-sandbox-<userId>-<ts>` and
 * are never persistent or resumable, so anything with the prefix older than
 * the staleness window is by definition orphaned and is deleted. This is
 * defense in depth, not the primary lifecycle — runs delete themselves.
 */
const EPHEMERAL_SANDBOX_NAME_PREFIX = 'overlay-sandbox-'
const DEFAULT_STALE_MS = 15 * 60_000

export type EphemeralSandboxListItem = {
  createdAt: number
  name: string
  persistent: boolean
}

export type EphemeralSandboxSweepDeps = {
  hasCredentials?: () => boolean
  list?: () => AsyncIterable<{ sandboxes: EphemeralSandboxListItem[] }>
  remove?: (name: string) => Promise<void>
}

export type EphemeralSandboxSweepResult = {
  swept: string[]
  errors: number
  skipped?: string
}

export async function sweepEphemeralSandboxes(args?: {
  deps?: EphemeralSandboxSweepDeps
  staleAfterMs?: number
}): Promise<EphemeralSandboxSweepResult> {
  const deps = args?.deps ?? {}
  const hasCredentials = deps.hasCredentials ?? (() => vercelSandboxCredentialParams() !== null)
  if (!hasCredentials()) return { swept: [], errors: 0, skipped: 'credentials_unconfigured' }
  const list = deps.list ?? defaultList
  const remove = deps.remove ?? defaultRemove
  const staleBefore = Date.now() - Math.max(0, args?.staleAfterMs ?? ephemeralSandboxStaleMs())
  const swept: string[] = []
  let errors = 0
  for await (const page of list()) {
    for (const item of page.sandboxes) {
      // Vercel-created timestamps are ms since epoch. The persistent check is
      // belt-and-suspenders: managed-agent and harness sandboxes use other
      // name prefixes AND are created persistent, so either guard alone
      // excludes them — together they cannot match.
      if (item.persistent !== false || item.createdAt >= staleBefore) continue
      try {
        await remove(item.name)
        swept.push(item.name)
      } catch (error) {
        errors += 1
        logger.warn('[Sandbox] Ephemeral sandbox sweep delete failed', {
          error: error instanceof Error ? error.message : String(error),
          sandbox: item.name,
        })
      }
    }
  }
  if (swept.length > 0 || errors > 0) {
    logger.warn('[Sandbox] Ephemeral sandbox sweep', { deleted: swept.length, errors })
  }
  return { swept, errors }
}

async function* defaultList() {
  const credentials = vercelSandboxCredentialParams() ?? {}
  const listed = await Sandbox.list({ namePrefix: EPHEMERAL_SANDBOX_NAME_PREFIX, ...credentials })
  for await (const page of listed.pages()) {
    yield { sandboxes: page.sandboxes }
  }
}

async function defaultRemove(name: string) {
  const credentials = vercelSandboxCredentialParams() ?? {}
  const sandbox = await Sandbox.get({ name, ...credentials })
  await sandbox.delete()
}

/**
 * Mirrors the credential resolution in `managedSandboxRuntimeFromEnv`: on
 * Vercel the SDK authenticates per-request via OIDC; elsewhere the static
 * token triple is required.
 */
function vercelSandboxCredentialParams() {
  if (process.env.VERCEL?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim()) return {}
  const token = process.env.VERCEL_TOKEN?.trim()
  const teamId = process.env.VERCEL_TEAM_ID?.trim()
  const projectId = process.env.VERCEL_PROJECT_ID?.trim()
  return token && teamId && projectId ? { token, teamId, projectId } : null
}

function ephemeralSandboxStaleMs() {
  const configured = Number(process.env.OVERLAY_EPHEMERAL_SANDBOX_STALE_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_STALE_MS
}
