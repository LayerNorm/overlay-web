import type { DriveContentResult, DriveMetadataRequest, DriveMetadataResult, DriveUploadRequest } from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentDriveClient } from './drive-client.js'
import { SqliteDriveJournal, type DriveJournalRecord } from './drive-journal.js'

type WriteReceipt = { requestId: string } & (
  { kind: 'content'; result: DriveContentResult } | { kind: 'metadata'; result: DriveMetadataResult }
)

/** Journal first, then send. A failed operation stays pending for an explicit same-execution retry. */
export class AgentDriveWriter {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly journal: SqliteDriveJournal,
    private readonly client: Pick<AgentDriveClient, 'intent' | 'upload' | 'commit' | 'metadata'>) {}

  content(request: DriveUploadRequest, bytes: Uint8Array): Promise<WriteReceipt> {
    this.journal.prepareContent(request, bytes)
    return this.serial(() => this.send(request.requestId))
  }

  metadata(request: DriveMetadataRequest): Promise<WriteReceipt> {
    this.journal.prepareMetadata(request)
    return this.serial(() => this.send(request.requestId))
  }

  /** Call before hydration or terminal completion. Errors preserve every remaining intent and payload. */
  flush(): Promise<WriteReceipt[]> {
    return this.serial(async () => {
      const receipts: WriteReceipt[] = []
      for (const record of this.journal.pending()) receipts.push(await this.send(record.request.requestId))
      return receipts
    })
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work)
    this.tail = pending.catch(() => undefined)
    return pending
  }

  private async send(requestId: string): Promise<WriteReceipt> {
    let record = this.journal.find(requestId)
    if (!record) throw Error('DRIVE_JOURNAL_UNAVAILABLE')
    if (record.phase.kind === 'committed') return receipt(record)
    if (record.kind === 'metadata') {
      this.journal.advanceMetadata(requestId)
      const result = await this.client.metadata(record.request)
      return receipt(this.journal.advanceMetadata(requestId, result))
    }
    // Reauthorize even an uncertain commit: its short-lived intent may have
    // expired during the outage. The server returns the same identity/receipt.
    const intent = await this.client.intent(record.request)
    if (intent.state === 'committed') return receipt(this.journal.commitContent(requestId, intent.uploadId, intent.result))
    record = this.journal.advanceContent(requestId, 'intent', intent.uploadId)
    if (record.phase.kind === 'intent') {
      await this.client.upload(intent, this.journal.content(requestId), record.request.sha256)
      record = this.journal.advanceContent(requestId, 'uploaded', intent.uploadId)
    }
    this.journal.advanceContent(requestId, 'committing', intent.uploadId)
    return receipt(this.journal.commitContent(requestId, intent.uploadId, await this.client.commit(intent.uploadId)))
  }
}

function receipt(record: DriveJournalRecord): WriteReceipt {
  if (record.kind === 'content' && record.phase.kind === 'committed') return { requestId: record.request.requestId, kind: 'content', result: record.phase.result }
  if (record.kind === 'metadata' && record.phase.kind === 'committed') return { requestId: record.request.requestId, kind: 'metadata', result: record.phase.result }
  throw Error('DRIVE_WRITE_UNSAVED')
}
