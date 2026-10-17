import type { DriveSavedEntry } from '@layernorm/overlay-agent-bridge-protocol'
import type { EmitAgentEvent, NormalizedAgentEvent } from './adapter.js'
import type { RuntimeDrive } from './runtime-drive.js'

/** Coalesced write-through work stays off the provider's streaming path. */
export class RuntimeDriveController {
  private readonly timer: ReturnType<typeof setInterval>
  private syncing?: Promise<void>
  private finishing = false
  private closed = false
  private closing?: Promise<void>
  private lastSummary = '[]'
  private lastError = false

  constructor(private readonly drive: RuntimeDrive, private readonly forward: EmitAgentEvent, intervalMs = 15000) {
    this.timer = setInterval(() => { this.schedule() }, intervalMs)
    this.timer.unref?.()
  }

  readonly emit: EmitAgentEvent = async event => {
    if (this.closed) return
    if (['completed', 'failed', 'cancelled'].includes(event.type)) {
      if (this.finishing) return
      this.finishing = true
      this.stopScheduling()
      await this.finish(event)
      return
    }
    await this.forward(event)
    if (!this.finishing && event.type === 'action' && event.payload.status === 'completed') this.schedule()
  }

  stopScheduling(): void { clearInterval(this.timer) }

  closeAfterStopped(): Promise<void> {
    if (this.closing) return this.closing
    this.finishing = true
    this.stopScheduling()
    this.closing = (async () => {
      await this.syncing
      await this.drive.close()
      this.closed = true
    })()
    return this.closing
  }

  private schedule(): void {
    if (this.finishing || this.syncing) return
    const pass = this.drive.sync().then(entries => this.finishing ? undefined : this.publish(entries), async () => {
      this.lastError = true
      if (!this.finishing) await this.unsaved()
    })
    this.syncing = pass.catch(() => undefined).finally(() => { this.syncing = undefined })
  }

  private async finish(event: NormalizedAgentEvent): Promise<void> {
    try {
      if (event.type === 'cancelled') {
        // Cancellation revokes write authority. Preserve the pending journal and confirm
        // process cancellation immediately; drain any already-started sync before unlocking.
        if (this.lastError) await this.unsaved()
        await this.forward(event)
        return
      }
      await this.forward({ type: 'drive_sync', payload: { state: 'saving' } })
      await this.syncing
      try {
        const entries = await this.drive.sync(true)
        await this.publish(entries, true)
      } catch {
        await this.unsaved()
        await this.forward(event.type === 'completed' ? { type: 'failed', payload: {
          code: 'drive_unsaved', message: 'Files could not be saved. The local copies were kept on the agent machine.', retryable: true,
        } } : event)
        return
      }
      await this.forward(event)
    } finally { await this.closeAfterStopped() }
  }

  private async publish(entries: DriveSavedEntry[], force = false): Promise<void> {
    const summary = JSON.stringify(entries)
    if (!force && !this.lastError && summary === this.lastSummary) return
    await this.forward({ type: 'drive_sync', payload: { state: 'saved',
      fileCount: entries.filter(entry => entry.kind === 'file').length,
      folderCount: entries.filter(entry => entry.kind === 'folder').length, entries: entries.slice(0, 32),
    } })
    this.lastSummary = summary
    this.lastError = false
  }

  private unsaved(): Promise<void> {
    return this.forward({ type: 'drive_sync', payload: { state: 'unsaved', code: 'DRIVE_SYNC_FAILED',
      message: 'Files could not be saved. The local copies were kept on the agent machine.',
    } })
  }
}
