/** Reports command receipt while credentials, drive hydration and provider initialization are pending. */
export async function withRunPreparation<T>(options: {
  enabled: boolean
  active(): boolean
  emit(): Promise<void>
  onError(error: unknown): void
  heartbeatMs?: number
}, work: () => Promise<T>): Promise<T> {
  if (!options.enabled) return work()
  await options.emit()
  let pending: Promise<void> | undefined
  const timer = setInterval(() => {
    if (pending || !options.active()) return
    pending = options.emit().catch(options.onError).finally(() => { pending = undefined })
  }, options.heartbeatMs ?? 10_000)
  timer.unref?.()
  try { return await work() }
  finally { clearInterval(timer); await pending }
}
