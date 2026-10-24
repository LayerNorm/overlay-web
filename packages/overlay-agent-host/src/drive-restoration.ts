import {driveRecoveryRequestSchema, type DriveRecoveryRequest} from '@layernorm/overlay-agent-bridge-protocol'
import type {AgentDriveClient} from './drive-client.js'
import type {DriveJournalContext, DriveJournalRecord, SqliteDriveJournal} from './drive-journal.js'
import type {SqliteDriveSyncState} from './drive-sync-state.js'
import type {AgentDriveSynchronizer} from './drive-sync.js'

/** Same canonical operation tuple used by the backend; expired MAC and credential envelopes are excluded. */
export function driveRecoveryRequest(record: DriveJournalRecord, previousExecution: NonNullable<DriveJournalContext['execution']>): DriveRecoveryRequest {
  let fingerprint: string
  const op = record.request.operation
  if (record.kind === 'content') {
    const operation = record.request.operation
    fingerprint = JSON.stringify([operation.kind, operation.kind === 'create' ? [operation.name, operation.parentId ?? null]
      : [operation.entry.fileId, operation.entry.path, operation.entry.updatedAt], record.request.sha256, record.request.sizeBytes, record.request.mimeType])
  } else if (op.kind === 'mkdir') fingerprint = JSON.stringify(['mkdir', op.name, op.parentId ?? null])
  else if (op.kind === 'move') fingerprint = JSON.stringify(['move', op.entry.fileId, op.entry.path, op.entry.updatedAt, op.name, op.parentId ?? null])
  else if (op.kind === 'remove') fingerprint = JSON.stringify(['remove', op.entry.fileId, op.entry.path, op.entry.updatedAt])
  else throw Error('DRIVE_JOURNAL_REQUEST_CONFLICT')
  return driveRecoveryRequestSchema.parse({action: 'recover', requestId: record.request.requestId,
    kind: record.kind, previousExecution, fingerprint})
}

/** Call under the physical cache lease, using only the old journal and the new execution's authenticated client. */
export async function settleInterruptedDrive(options: {previousExecution: NonNullable<DriveJournalContext['execution']>;
  journal: SqliteDriveJournal; state: SqliteDriveSyncState; client: Pick<AgentDriveClient, 'recover'>;
  synchronizer: Pick<AgentDriveSynchronizer, 'settlePreviousWrite'>}) {
  const state = options.state.read(), pending = options.journal.pending()
  if (pending.some(record => state.phase !== 'writing' || record.request.requestId !== state.operation.request.requestId))
    throw Error('DRIVE_UNTRACKED_PENDING_WRITE')
  for (const record of pending) {
    if (state.phase !== 'writing' || record.kind !== state.operation.kind
      || JSON.stringify(record.request) !== JSON.stringify(state.operation.request)) throw Error('DRIVE_JOURNAL_REQUEST_CONFLICT')
    const outcome = await options.client.recover(driveRecoveryRequest(record, options.previousExecution))
    options.journal.settleRecovery(record.request.requestId, outcome)
  }
  await options.synchronizer.settlePreviousWrite()
}
