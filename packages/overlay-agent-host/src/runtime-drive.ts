import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { driveCredentialsResponseSchema, type DriveCredentialsResponse, type DriveSavedEntry, type FilesystemGrant } from '@layernorm/overlay-agent-bridge-protocol'
import { AgentDriveCache } from './drive-cache.js'
import { AgentDriveClient } from './drive-client.js'
import { SqliteDriveJournal, type DriveJournalContext } from './drive-journal.js'
import { AgentDriveLease } from './drive-lease.js'
import { SqliteDriveSyncState } from './drive-sync-state.js'
import { AgentDriveSynchronizer } from './drive-sync.js'
import {settleInterruptedDrive} from './drive-restoration.js'
import { resolveFilesystemScope } from './filesystem-policy.js'

export type RuntimeDrive = {
  workingDirectory: string
  additionalDirectories: string[]
  sync(final?: boolean): Promise<DriveSavedEntry[]>
  close(): Promise<void>
}

/** Called after refreshing the device's approved filesystem policy, before starting any adapter. */
export async function createRuntimeDrive(options: {
  environmentId: string; workspaceId: string; runId: string; sessionId: string
  execution?: DriveJournalContext['execution']
  previousExecution?: NonNullable<DriveJournalContext['execution']>
  location: 'cloud' | 'approved-root'
  approvedWorkingDirectory: string
  filesystem: FilesystemGrant
  stateDirectory: string
  apiUrl: string
  credentials(): Promise<DriveCredentialsResponse>
  fetch?: typeof globalThis.fetch
}): Promise<RuntimeDrive> {
  let initial: DriveCredentialsResponse | undefined = driveCredentialsResponseSchema.parse(await options.credentials())
  if (initial.scope.workspaceId !== options.workspaceId) throw Error('DRIVE_SCOPE_CHANGED')
  const scope = initial.scope
  const identity = createHash('sha256').update(JSON.stringify([options.environmentId, scope])).digest('hex').slice(0, 24)
  const parent = options.location === 'cloud' ? '/home/user' : options.approvedWorkingDirectory
  const cacheName = options.location === 'cloud' ? 'drive' : `.overlay-drive-${identity}`
  assertCreationAllowed(options.filesystem, join(parent, cacheName))
  // Validate a local parent physically before mkdir: an approved lexical path can
  // contain a symlink that resolves outside the person's approved filesystem.
  const approvedParent = options.location === 'cloud' ? parent
    : (await resolveFilesystemScope(options.filesystem, parent)).workingDirectory
  const cache = await AgentDriveCache.create(approvedParent, cacheName)
  const resolved = await resolveFilesystemScope(options.filesystem, cache.root)
  const stateRoot = join(options.stateDirectory, 'drive', createHash('sha256').update(cache.root).digest('hex').slice(0, 32))
  const lease = AgentDriveLease.acquire(join(stateRoot, 'lease.sqlite'), cache.root, scope)
  let journal: SqliteDriveJournal | undefined, state: SqliteDriveSyncState | undefined
  try {
    state = new SqliteDriveSyncState(join(stateRoot, 'baseline.sqlite'), cache.root, scope)
    const client = new AgentDriveClient({ apiUrl: options.apiUrl, ...(options.fetch ? { fetch: options.fetch } : {}), credentials: async () => {
      if (initial) { const value = initial; initial = undefined; return value }
      return options.credentials()
    } })
    const context = {environmentId: options.environmentId, runId: options.runId, sessionId: options.sessionId,
      scope, ...(options.execution ? {execution: options.execution} : {})}
    if (options.previousExecution) {
      if (!options.execution || options.execution.attemptId === options.previousExecution.attemptId
        || options.execution.generation !== options.previousExecution.generation + 1) throw Error('DRIVE_JOURNAL_EXECUTION_CHANGED')
      journal = openCurrentPreparationJournal(join(stateRoot, 'writes.sqlite'), context, state)
      if (!journal) {
        journal = new SqliteDriveJournal(join(stateRoot, 'writes.sqlite'), {...context,
          sessionId: options.previousExecution.attemptId, execution: options.previousExecution})
        const synchronizer = new AgentDriveSynchronizer({runId: options.runId, cache, client, journal, state})
        await settleInterruptedDrive({previousExecution: options.previousExecution, journal, state, client, synchronizer})
        journal.close(); journal = undefined
      }
    }
    journal ??= new SqliteDriveJournal(join(stateRoot, 'writes.sqlite'), context)
    const synchronizer = new AgentDriveSynchronizer({ runId: options.runId, cache, client, journal, state })
    await synchronizer.initialize()
    const ownedJournal = journal, ownedState = state
    let closed = false
    return {
      ...resolved,
      sync: final => { if (closed) return Promise.reject(Error('DRIVE_CLOSED')); return synchronizer.sync(final) },
      close: async () => {
        if (closed) return
        closed = true
        await synchronizer.settle()
        try { ownedJournal.close() } finally { try { ownedState.close() } finally { lease.release() } }
      },
    }
  } catch (error) {
    try { journal?.close() } finally { try { state?.close() } finally { lease.release() } }
    throw error
  }
}

/** A retried preparation may already own a pending write after settling its predecessor. Never adopt a foreign request. */
function openCurrentPreparationJournal(path: string, context: DriveJournalContext, state: SqliteDriveSyncState): SqliteDriveJournal | undefined {
  let journal: SqliteDriveJournal | undefined
  try {
    journal = new SqliteDriveJournal(path, context)
    const snapshot = state.read()
    if (snapshot.phase === 'writing') journal.find(snapshot.operation.request.requestId)
    return journal
  } catch (error) {
    journal?.close()
    if (error instanceof Error && ['DRIVE_UNSAVED_OTHER_EXECUTION', 'DRIVE_JOURNAL_EXECUTION_CHANGED'].includes(error.message)) return undefined
    throw error
  }
}

function assertCreationAllowed(grant: FilesystemGrant, requested: string) {
  if (!isAbsolute(requested)) throw Error('DRIVE_OUTSIDE_FILESYSTEM_GRANT')
  if (grant.mode === 'all_user_files') return
  if (!grant.roots.some(root => {
    if (!isAbsolute(root)) return false
    const tail = relative(resolve(root), resolve(requested))
    return tail === '' || !isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`)
  })) throw Error('DRIVE_OUTSIDE_FILESYSTEM_GRANT')
}
