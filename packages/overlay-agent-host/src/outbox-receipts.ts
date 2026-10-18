import type {EventAcknowledgement, NativeStartAdmission} from '@layernorm/overlay-agent-bridge-protocol'
import type {SqliteHostStateStore} from './state.js'

/** Wait for a specific durable watermark without waiting for unrelated producers to go quiet. */
export class OutboxReceipts {
  private readonly admissions = new Map<string, NativeStartAdmission>()
  private readonly listeners = new Set<() => void>()

  record(acknowledgement: Extract<EventAcknowledgement, {accepted: true}>): void {
    if (acknowledgement.nativeStartAdmission) this.admissions.set(acknowledgement.nativeStartAdmission.commandId, acknowledgement.nativeStartAdmission)
    for (const listener of this.listeners) listener()
  }

  takeNativeAdmission(commandId: string): NativeStartAdmission | undefined {
    const admitted = this.admissions.get(commandId)
    this.admissions.delete(commandId)
    return admitted
  }

  async drainThrough(input: {state: SqliteHostStateStore; runId: string; attemptId: string; throughSequence: number; signal?: AbortSignal; flush(): Promise<void>}): Promise<void> {
    const ready = () => !input.state.hasPendingEventsThrough(input.runId, input.attemptId, input.throughSequence)
    input.signal?.throwIfAborted()
    while (!ready()) {
      let onAbort: () => void = () => undefined
      let notify: () => void = () => undefined
      const receipt = new Promise<void>(resolve => {notify = resolve})
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(input.signal?.reason ?? Error('Preparation interrupted'))
        input.signal?.addEventListener('abort', onAbort, {once: true})
      })
      const listener = () => {if (ready()) notify()}
      this.listeners.add(listener)
      try {
        const reached = await Promise.race([aborted, receipt.then(() => true), input.flush().then(() => false)])
        if (reached || ready()) return
        if (input.state.outboxSize() === 0) throw Error('The event watermark was not acknowledged')
      } finally {this.listeners.delete(listener); input.signal?.removeEventListener('abort', onAbort)}
    }
  }
}
