import type {AgentAdapterSession} from './adapter.js'

/** A host cannot close SQLite while a prompt can still call its event callbacks. */
export class PendingHostPrompts {
  private readonly pending = new Set<Promise<void>>()
  constructor(private readonly onError: (error: unknown) => void) {}

  track(work: Promise<void>): void {
    const settled = work.catch(this.onError).finally(() => {this.pending.delete(settled)})
    this.pending.add(settled)
  }

  async settle(): Promise<void> {await Promise.all([...this.pending])}
}

export async function quiesceHostRuns(input: {
  sessions: Iterable<AgentAdapterSession>
  prompts: PendingHostPrompts
  streams: Iterable<{drain(): Promise<void>}>
  drives: Iterable<{stopScheduling(): void; closeAfterStopped(): Promise<void>}>
}): Promise<void> {
  const drives = [...input.drives]
  for (const drive of drives) drive.stopScheduling()
  const stopped = await Promise.allSettled([...input.sessions].map(session => session.stop('Agent host shutting down')))
  const failures = stopped.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  // Keep cache ownership when an old writer is uncertain. Do not attest that shutdown drained.
  if (failures.length) throw new AggregateError(failures, 'Provider termination was not confirmed during host shutdown')
  await input.prompts.settle()
  await Promise.all([...input.streams].map(stream => stream.drain()))
  await Promise.all(drives.map(drive => drive.closeAfterStopped()))
}
