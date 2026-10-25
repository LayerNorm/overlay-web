export async function claimComputerMaintenanceWithRetry(
  claim: () => Promise<unknown | null>,
  options: {
    retryUnavailable: boolean
    now: () => number
    sleep: (ms: number) => Promise<void>
  },
): Promise<void> {
  const deadline = options.now() + 20_000
  let delayMs = 250
  let waitedMs = 0
  while (true) {
    if (await claim()) return
    if (!options.retryUnavailable) throw new Error('COMPUTER_MAINTENANCE_IN_PROGRESS')
    const remainingMs = Math.min(20_000 - waitedMs, deadline - options.now())
    if (remainingMs <= 0) throw new Error('COMPUTER_MAINTENANCE_IN_PROGRESS')
    const sleepMs = Math.min(delayMs, remainingMs)
    await options.sleep(sleepMs)
    waitedMs += sleepMs
    delayMs = Math.min(delayMs * 2, 2_000)
  }
}
