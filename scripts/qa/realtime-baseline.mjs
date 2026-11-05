import { performance } from 'node:perf_hooks'

export function previewOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !/^pr-[1-9][0-9]*\.preview\.getoverlay\.io$/.test(url.hostname)
    || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('An isolated canonical PR Preview origin is required')
  }
  return url.origin
}

export function previewPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
    || value.includes('\\') || /[\r\n\t]/.test(value)) throw new Error('A relative app path is required')
  return value
}

// All elapsed times use the same runner clock, not clocks from different tabs.
// Observers must be armed synchronously and reject on their own timeout.
export async function measureInteraction({ trigger, observers, now = () => performance.now(),
  stages: stageNames = ['localFeedback', 'mutationAcknowledged', 'remoteVisible'] }) {
  let startedAt
  const pending = Object.fromEntries(stageNames.map((stage) => {
    const observe = observers[stage]
    if (!observe) return [stage, Promise.resolve({ status: 'unavailable', ms: null })]
    const promise = observe().then(() => {
      if (startedAt === undefined) return { status: 'invalid-precondition', ms: null }
      return { status: 'observed', ms: Math.round((now() - startedAt) * 100) / 100 }
    }, () => ({ status: 'not-observed', ms: null }))
    return [stage, promise]
  }))
  // Let already-satisfied observers invalidate the sample before triggering.
  await Promise.resolve()
  startedAt = now()
  let action = 'completed'
  try { await trigger() } catch { action = 'failed' }
  const stages = Object.fromEntries(await Promise.all(
    Object.entries(pending).map(async ([key, promise]) => [key, await promise]),
  ))
  return { action, stages }
}

export async function openIndependentClients(browser, { origin, path, storageState, requirePersonalQueryReady = true }) {
  const base = previewOrigin(origin)
  const destination = `${base}${previewPath(path)}`
  const contexts = []
  try {
    for (let i = 0; i < 2; i += 1) {
      const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } })
      contexts.push(context)
      await context.addInitScript(() => performance.mark('overlay:baseline:enabled'))
    }
    const pages = await Promise.all(contexts.map((context) => context.newPage()))
    const queryReady = await Promise.all(pages.map(async (page) => {
      const start = performance.now()
      await page.goto(destination, { waitUntil: 'domcontentloaded' })
      // A missing auth session, wrong route, or disabled subscription fails setup.
      if (requirePersonalQueryReady) {
        await page.waitForFunction(() => performance.getEntriesByName('overlay:baseline:personal-query-ready').length > 0,
          null, { timeout: 30_000 })
      }
      if (new URL(page.url()).origin !== base) throw new Error('Preview navigation left its origin')
      return requirePersonalQueryReady ? Math.round(performance.now() - start) : null
    }))
    return { pages, queryReady, close: () => Promise.all(contexts.map((context) => context.close())) }
  } catch (error) {
    await Promise.all(contexts.map((context) => context.close()))
    throw error
  }
}
