// UI perf baseline (Phase 0 of the UI snappiness plan).
//
// Measures four lab scenarios against a production build (local `next start`
// or a PR Preview) with a pre-signed-in Playwright storage state:
//
//   cold-start              navigation start -> composer usable, transcript painted, FCP, LCP
//   thread-switch           sidebar click -> active row (feedback) -> thread content visible, cold and warm
//   typing-while-streaming  keystroke -> next frame while a reply streams, plus render counts
//   dm-scroll               DOM growth while older DM pages load, frame timing while scrolling
//
// Fixtures are supplied by the operator (see docs in internal/develop/perf-baseline.md);
// the script never creates, renames or deletes workspace data except sending
// PERF_PROMPT once per typing run in the chat at PERF_CHAT_PATH.
//
// Usage:
//   PERF_ORIGIN=http://localhost:3000 PERF_STORAGE_STATE=.perf/state.json \
//   PERF_CHAT_PATH=/app/chat PERF_THREAD_A=... PERF_THREAD_B=... PERF_THREAD_B_SENTINEL=... \
//   PERF_DM_PATH=/app/chat?... npm run perf:baseline
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright'
import { measureInteraction } from './realtime-baseline.mjs'
import { fixtureStarter } from './perf-fixture.mjs'
import {
  THROTTLE_PROFILES, appPath, frameReport, markdownReport, parseScenarios, perfOrigin,
  positiveInteger, requireObservedInteraction, renderDelta, streamingRenderReport, summarize,
} from './perf-baseline-lib.mjs'

const env = process.env
const TIMEOUT = positiveInteger(env.PERF_TIMEOUT_MS, 30_000, 120_000)
let lastStage = 'setup'
let sampleRun = 0
let validationDetails

function required(name) {
  const value = env[name]
  if (!value) throw new Error(`${name} is required for this scenario`)
  return value
}

function gitRevision() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

async function newContext(browser, { storageState, origin, perfFlag = false }) {
  validationDetails = undefined
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', async route => {
    const request = route.request()
    if (request.isNavigationRequest() && new URL(request.url()).origin !== origin) {
      await route.abort()
      return
    }
    await route.continue()
  })
  await context.addInitScript((enablePerfCounters) => {
    performance.mark('overlay:baseline:enabled')
    if (enablePerfCounters) window.localStorage.setItem('overlay_perf', '1')
    else window.localStorage.removeItem('overlay_perf')
  }, perfFlag)
  return context
}

async function throttle(page, profileName) {
  const profile = THROTTLE_PROFILES[profileName]
  if (!profile) return
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate })
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', profile.network)
}

async function waitForMark(page, name) {
  await page.waitForFunction((mark) => performance.getEntriesByName(mark).length > 0, name, { timeout: TIMEOUT })
}

function assertSameOrigin(page, origin) {
  if (new URL(page.url()).origin !== origin) throw new Error('Navigation left the perf origin')
}

async function navigateAuthenticated(page, origin, route) {
  const authenticated = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.origin === origin && url.pathname === '/api/auth/convex-token' && response.status() === 200
  }, { timeout: TIMEOUT }).then(() => true, () => false)
  lastStage = 'navigation'
  await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' })
  assertSameOrigin(page, origin)
  lastStage = 'native-authentication'
  if (!await authenticated) throw new Error('Native authentication was not confirmed')
}

// ── cold start ──────────────────────────────────────────────────────────────
async function coldStart({ browser, origin, storageState, runs, throttleName }) {
  const chatPath = appPath(env.PERF_CHAT_PATH ?? '/app/chat')
  const sentinel = env.PERF_CHAT_SENTINEL
  const samples = { ttfb: [], fcp: [], lcpAtReadiness: [], composerReady: [], transcriptVisible: [] }
  for (let run = 0; run < runs; run += 1) {
    sampleRun = run + 1
    lastStage = 'browser-context'
    const context = await newContext(browser, { storageState, origin })
    try {
      const page = await context.newPage()
      await throttle(page, throttleName)
      await page.addInitScript(() => {
        window.__perfLcp = 0
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__perfLcp = entry.startTime
        }).observe({ type: 'largest-contentful-paint', buffered: true })
      })
      lastStage = 'navigation'
      await navigateAuthenticated(page, origin, chatPath)
      assertSameOrigin(page, origin)
      lastStage = 'composer-ready-mark'
      await waitForMark(page, 'overlay:baseline:composer-ready')
      lastStage = 'editable-composer'
      const input = page.locator('[data-chat-composer] [contenteditable="true"]').first()
      await input.waitFor({ state: 'visible', timeout: TIMEOUT })
      if (!await input.isEditable()) throw new Error('Composer is not editable')
      const composerReady = await page.evaluate(() => performance.now())
      let transcriptVisible = null
      if (sentinel) {
        lastStage = 'transcript-sentinel'
        await page.locator('[data-chat-transcript]').getByText(sentinel, { exact: true }).first()
          .waitFor({ state: 'visible', timeout: TIMEOUT })
        transcriptVisible = await page.evaluate(() => performance.now())
      }
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0]
        const markAt = (name) => performance.getEntriesByName(name)[0]?.startTime ?? null
        return {
          ttfb: nav ? nav.responseStart : null,
          fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
          lcpAtReadiness: window.__perfLcp || null,
          composerMountedReady: markAt('overlay:baseline:composer-ready'),
        }
      })
      samples.composerReady.push(composerReady)
      if (transcriptVisible !== null) samples.transcriptVisible.push(transcriptVisible)
      for (const key of ['ttfb', 'fcp', 'lcpAtReadiness']) if (timing[key] != null) samples[key].push(timing[key])
    } finally {
      await context.close()
    }
  }
  return { samples, metrics: Object.fromEntries(Object.entries(samples).map(([key, values]) => [`${key}Ms`, summarize(values)])) }
}

// ── thread switch ───────────────────────────────────────────────────────────
async function threadSwitch({ browser, origin, storageState, runs, throttleName }) {
  const startPath = appPath(required('PERF_THREAD_START_PATH'))
  const nameA = required('PERF_THREAD_A')
  const nameB = required('PERF_THREAD_B')
  const sentinelA = required('PERF_THREAD_A_SENTINEL')
  const sentinelB = required('PERF_THREAD_B_SENTINEL')
  const samples = { coldFeedback: [], coldContent: [], warmFeedback: [], warmContent: [] }

  const row = (page, name) => page.locator('[data-slot="sidebar-menu-sub-item"]')
    .filter({ has: page.getByText(name, { exact: true }) })
  const open = async (page, name, sentinel) => {
    lastStage = 'destination-row'
    const target = row(page, name)
    await target.waitFor({ state: 'visible', timeout: TIMEOUT })
    if (await target.locator('[aria-current="page"]').count()) throw new Error('Destination already selected')
    const content = page.locator('[data-chat-transcript]').getByText(sentinel, { exact: true }).first()
    if (await content.isVisible()) throw new Error('Destination content already visible')
    lastStage = 'navigation-observations'
    return requireObservedInteraction(await measureInteraction({
      stages: ['localFeedback', 'contentVisible'],
      trigger: () => target.getByText(name, { exact: true }).click({ timeout: TIMEOUT }),
      observers: {
        localFeedback: () => target.locator('[aria-current="page"]').waitFor({ state: 'visible', timeout: TIMEOUT }),
        contentVisible: () => content.waitFor({ state: 'visible', timeout: TIMEOUT }),
      },
    }))
  }
  const push = (prefix, sample) => {
    requireObservedInteraction(sample)
    const { localFeedback, contentVisible } = sample.stages
    if (localFeedback.status === 'observed') samples[`${prefix}Feedback`].push(localFeedback.ms)
    if (contentVisible.status === 'observed') samples[`${prefix}Content`].push(contentVisible.ms)
  }

  for (let run = 0; run < runs; run += 1) {
    sampleRun = run + 1
    lastStage = 'browser-context'
    const context = await newContext(browser, { storageState, origin })
    try {
      const page = await context.newPage()
      await throttle(page, throttleName)
      // Start on a page where neither fixture thread is open, so B is cold.
      lastStage = 'navigation'
      await navigateAuthenticated(page, origin, startPath)
      assertSameOrigin(page, origin)
      if (await page.getByText(sentinelB, { exact: true }).count()) throw new Error('Thread B must not be open at start')
      push('cold', await open(page, nameB, sentinelB))
      await open(page, nameA, sentinelA)
      // B was opened in this session: this is the warm switch the plan targets at <=100 ms.
      push('warm', await open(page, nameB, sentinelB))
      assertSameOrigin(page, origin)
    } finally {
      await context.close()
    }
  }
  return {
    metrics: {
      coldFeedbackMs: summarize(samples.coldFeedback),
      coldContentVisibleMs: summarize(samples.coldContent),
      warmFeedbackMs: summarize(samples.warmFeedback),
      warmContentVisibleMs: summarize(samples.warmContent),
    },
  }
}

// ── typing while streaming ─────────────────────────────────────────────────
async function typingWhileStreaming({ browser, origin, storageState, runs, throttleName }) {
  const chatPath = appPath(required('PERF_STREAM_PATH'))
  const workload = env.PERF_STREAM_MODE ?? 'live'
  if (!['fixture', 'live'].includes(workload)) throw new Error('Invalid stream workload')
  const fixture = workload === 'fixture' ? fixtureStarter({
    origin, backend: required('PERF_FIXTURE_BACKEND'), deployKey: required('PERF_FIXTURE_DEPLOY_KEY'),
    allowed: env.PERF_ALLOW_FIXTURE_MUTATIONS, conversationId: new URL(chatPath, origin).searchParams.get('id'),
  }) : null
  if (!fixture && env.PERF_ALLOW_SEND !== '1') throw new Error('Sending requires PERF_ALLOW_SEND=1')
  const prompt = fixture ? null : required('PERF_PROMPT')
  const typed = 'quick brown fox'
  const latencies = []
  const reports = []
  let renders = null

  for (let run = 0; run <= runs; run += 1) {
    sampleRun = run
    lastStage = 'browser-context'
    // A separate counter run never contributes latency samples.
    const perfFlag = run === 0
    const context = await newContext(browser, { storageState, origin, perfFlag })
    try {
      const page = await context.newPage()
      await throttle(page, throttleName)
      lastStage = 'navigation'
      await navigateAuthenticated(page, origin, chatPath)
      assertSameOrigin(page, origin)
      lastStage = 'composer-ready-mark'
      await waitForMark(page, 'overlay:baseline:composer-ready')
      lastStage = 'idle-editable-composer'
      const input = page.locator('[data-chat-composer] [contenteditable="true"]').first()
      await input.waitFor({ state: 'visible', timeout: TIMEOUT })
      if (!await input.isEditable()) throw new Error('Composer is not editable')
      if ((await input.innerText()).trim()) throw new Error('Fixture must start without a draft')
      if (await page.locator('[data-text-streaming="true"]').count()) throw new Error('Fixture must start idle')
      const exchanges = page.locator('[data-chat-transcript] [data-exchange-idx]')
      if (fixture) {
        lastStage = 'fixture-history'
        await exchanges.first().waitFor({ state: 'visible', timeout: TIMEOUT })
        const minimum = positiveInteger(env.PERF_STREAM_MIN_EXCHANGES, 25, 1000)
        if (await exchanges.count() < minimum) throw new Error('Required stream fixture history was not loaded')
        if (new URL(page.url()).searchParams.get('id') !== new URL(chatPath, origin).searchParams.get('id')) {
          throw new Error('Stream fixture route is not selected')
        }
      }
      const before = await exchanges.count()
      lastStage = 'stream-start'
      if (fixture) {
        await fixture()
      } else {
        await input.click()
        await page.keyboard.type(prompt)
        await page.keyboard.press('Enter')
        await page.waitForFunction((count) => document.querySelectorAll('[data-chat-transcript] [data-exchange-idx]').length > count,
          before, { timeout: TIMEOUT })
      }
      const streaming = exchanges.last()
      lastStage = 'active-text-stream'
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('[data-chat-transcript] [data-exchange-idx]')
        const row = rows[rows.length - 1]
        return row?.getAttribute('data-text-streaming') === 'true' && row.querySelector('.markdown-content')?.textContent?.trim()
      }, null, { timeout: TIMEOUT }).catch(async error => {
        validationDetails = await page.evaluate(() => {
          const rows = document.querySelectorAll('[data-chat-transcript] [data-exchange-idx]')
          const last = rows[rows.length - 1]
          return {
            exchangeCount: rows.length,
            streamingRows: document.querySelectorAll('[data-text-streaming="true"]').length,
            markdownElements: last?.querySelectorAll('.markdown-content').length ?? 0,
            lastTextLength: last?.querySelector('.markdown-content')?.textContent?.length ?? 0,
          }
        })
        throw error
      })
      const initialText = await streaming.locator('.markdown-content').allTextContents()
      lastStage = 'typing-during-stream'
      if (perfFlag) await page.evaluate(() => window.__overlayPerfDebug?.reset())

      await input.evaluate((editor) => {
        window.__perfKeyLatency = []
        let start = null
        editor.addEventListener('keydown', (event) => {
          if (event.key.length === 1) start = event.timeStamp
        })
        editor.addEventListener('input', () => {
          if (start === null) return
          const startedAt = start
          start = null
          const value = editor.textContent
          requestAnimationFrame(() => setTimeout(() => {
            if (editor.textContent === value && document.querySelector('[data-text-streaming="true"]')) {
              window.__perfKeyLatency.push(performance.now() - startedAt)
            }
          }, 0))
        })
      })
      await input.click()
      for (const char of typed) {
        await page.keyboard.type(char)
        await page.waitForTimeout(80)
      }
      const measured = await page.evaluate(() => window.__perfKeyLatency)
      lastStage = 'continuous-stream-validation'
      validationDetails = {
        observedKeystrokes: measured.length,
        expectedKeystrokes: typed.length,
        streamActive: await streaming.getAttribute('data-text-streaming') === 'true',
        textAdvanced: JSON.stringify(initialText) !== JSON.stringify(await streaming.locator('.markdown-content').allTextContents()),
      }
      if (measured.length !== typed.length || !validationDetails.streamActive || !validationDetails.textAdvanced) {
        throw new Error('Text must continue streaming throughout every measured keystroke')
      }
      if (!perfFlag) latencies.push(...measured)

      if (perfFlag) {
        lastStage = 'stream-render-counters'
        const snapshot = await page.evaluate(() => window.__overlayPerfDebug?.snapshot() ?? null)
        if (!snapshot) throw new Error('Render instrumentation unavailable')
        renders = renderDelta({}, snapshot.renders)
        if (!(renders['ChatExchange(streaming)'] > 0)) throw new Error('No streaming renders observed')
        reports.push(streamingRenderReport(renders))
      }
      // Clear the draft so it is not sent; leave the reply to finish on its own.
      lastStage = 'stream-settled'
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Backspace')
      await page.waitForFunction(() => !document.querySelector('[data-text-streaming="true"]'), null, { timeout: TIMEOUT })
    } finally {
      await context.close()
    }
  }
  return {
    metrics: { keystrokeToFrameMs: summarize(latencies) },
    workload: fixture ? 'preview-public-stream-v1-80-paragraphs-150ms' : 'live-model-exploratory-not-a-deterministic-regression-gate',
    samples: latencies,
    renders: renders ? { during: renders, report: reports[0] } : undefined,
  }
}

// ── DM scroll ──────────────────────────────────────────────────────────────
async function dmScroll({ browser, origin, storageState, runs, throttleName }) {
  const dmPath = appPath(required('PERF_DM_PATH'))
  const pages = positiveInteger(env.PERF_DM_LOAD_PAGES, 40)
  const requiredMessages = positiveInteger(env.PERF_DM_MIN_MESSAGES, 1000, 10000)
  const fps = []
  const frameP75 = []
  const dropped = []
  const growth = []

  for (let run = 0; run < runs; run += 1) {
    sampleRun = run + 1
    lastStage = 'browser-context'
    const context = await newContext(browser, { storageState, origin })
    try {
      const page = await context.newPage()
      await throttle(page, throttleName)
      lastStage = 'navigation'
      await navigateAuthenticated(page, origin, dmPath)
      assertSameOrigin(page, origin)
      const rows = page.locator('[id^="room-message-"]')
      lastStage = 'dm-rows'
      await rows.first().waitFor({ state: 'visible', timeout: TIMEOUT })
      const scroller = page.locator('[data-chat-transcript]').locator('xpath=..')
      const box = await scroller.boundingBox()
      if (!box) throw new Error('DM scroll container not found')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

      const domSize = () => page.evaluate(() => ({
        rows: document.querySelectorAll('[id^="room-message-"]').length,
        nodes: document.querySelector('[data-chat-transcript]')?.querySelectorAll('*').length ?? 0,
        loaded: Number(document.querySelector('[data-chat-transcript]')?.getAttribute('data-loaded-message-count') ?? 0),
      }))
      const history = [await domSize()]
      lastStage = 'dm-history-pagination'
      for (let i = 0; history.at(-1).loaded < requiredMessages && i < pages; i += 1) {
        const before = history.at(-1).loaded
        const loadOlder = page.getByRole('button', { name: 'Load older messages', exact: true })
        await loadOlder.click({ timeout: TIMEOUT })
        await page.waitForFunction((count) => Number(document.querySelector('[data-chat-transcript]')
          ?.getAttribute('data-loaded-message-count')) > count, before, { timeout: TIMEOUT })
        history.push(await domSize())
      }
      if (history.at(-1).loaded < requiredMessages) throw new Error('Required DM history was not loaded')
      lastStage = 'dm-scroll-frames'
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await page.evaluate(() => {
        window.__perfFrames = []
        window.__perfRecording = true
        const tick = (time) => {
          if (!window.__perfRecording) return
          window.__perfFrames.push(time)
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      const scrollStart = await scroller.evaluate(element => element.scrollTop)
      for (let step = 0; step < 30; step += 1) {
        await page.mouse.wheel(0, -300)
        await page.waitForTimeout(50)
      }
      if (await scroller.evaluate(element => element.scrollTop) >= scrollStart) throw new Error('DM did not scroll')
      const frames = await page.evaluate(() => {
        window.__perfRecording = false
        return window.__perfFrames
      })
      const report = frameReport(frames)
      if (report.fps != null) fps.push(report.fps)
      if (report.frameP75 != null) frameP75.push(report.frameP75)
      if (report.frames < 2) throw new Error('No scroll frames recorded')
      dropped.push(report.hitchIntervals)
      growth.push(history)
    } finally {
      await context.close()
    }
  }
  const last = growth.at(-1) ?? []
  return {
    metrics: {
      scrollFps: summarize(fps),
      scrollFrameP75Ms: summarize(frameP75),
      scrollHitchIntervals: summarize(dropped),
      domNodesPerRow: summarize(last.filter((point) => point.rows).map((point) => point.nodes / point.rows)),
    },
    samples: { fps, frameP75, hitchIntervals: dropped },
    domGrowth: growth,
    requiredMessages,
  }
}

const RUNNERS = {
  'cold-start': coldStart,
  'thread-switch': threadSwitch,
  'typing-while-streaming': typingWhileStreaming,
  'dm-scroll': dmScroll,
}

let browser
try {
  const origin = perfOrigin(required('PERF_ORIGIN'))
  const storageState = required('PERF_STORAGE_STATE')
  if ((await stat(storageState)).mode & 0o077) throw new Error('PERF_STORAGE_STATE must be private (chmod 600)')
  const throttleName = env.PERF_THROTTLE ?? 'fast-4g-cpu4x'
  if (!(throttleName in THROTTLE_PROFILES)) throw new Error(`Unknown PERF_THROTTLE: ${throttleName}`)
  const runs = positiveInteger(env.PERF_RUNS, 5)
  const scenarios = parseScenarios(env.PERF_SCENARIOS)
  const outDir = path.resolve(env.PERF_OUT_DIR ?? '.perf')

  browser = await chromium.launch({
    headless: true,
    ...(env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  })
  const result = {
    revision: gitRevision(),
    targetRevision: required('PERF_TARGET_REVISION'),
    originKind: origin.startsWith('http://') ? 'local' : 'preview',
    throttle: throttleName,
    runs,
    capturedAt: new Date().toISOString(),
    scenarios: {},
  }
  if (!/^[a-f0-9]{40}$/.test(result.targetRevision)) throw new Error('Expected target revision SHA')
  for (const scenario of scenarios) {
    lastStage = 'scenario-configuration'
    sampleRun = 0
    validationDetails = undefined
    console.error(`[perf-baseline] ${scenario}...`)
    try {
      result.scenarios[scenario] = await RUNNERS[scenario]({ browser, origin, storageState, runs, throttleName })
    } catch {
      // Report the failure without page content, URLs or credentials.
      result.scenarios[scenario] = {
        error: 'Scenario failed validation; no samples accepted. Check fixture preconditions and configuration.',
        lastStage, sampleRun, validationDetails,
      }
      process.exitCode = 1
    }
  }
  await mkdir(outDir, { recursive: true })
  const stamp = result.capturedAt.replace(/[:.]/g, '-')
  await writeFile(path.join(outDir, `perf-baseline-${stamp}.json`), `${JSON.stringify(result, null, 2)}\n`)
  await writeFile(path.join(outDir, `perf-baseline-${stamp}.md`), markdownReport(result))
  console.log(markdownReport(result))
} catch {
  console.error('Perf baseline failed configuration or setup validation; no private diagnostics emitted.')
  process.exitCode = 1
} finally {
  await browser?.close()
}
