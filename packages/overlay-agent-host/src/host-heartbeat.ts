/** Host liveness must continue while a command is hydrating or starting a provider. */
export class HostHeartbeat {
  private lastSucceededAt = 0
  private pending?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  private stopped = false

  constructor(private readonly request: () => Promise<void>) {}

  due(): boolean { return Date.now() - this.lastSucceededAt >= 30000 }

  send(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.pending) return this.pending
    this.pending = (async () => {
      await this.request()
      this.lastSucceededAt = Date.now()
    })().finally(() => { this.pending = undefined })
    return this.pending
  }

  start(signal: AbortSignal, onError: (error: unknown) => void): void {
    this.stopped = false
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => {
      if (!signal.aborted && this.due()) void this.send().catch(onError)
    }, 10000)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.pending?.catch(() => undefined)
  }
}
