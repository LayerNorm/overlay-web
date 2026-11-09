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
import {
  THROTTLE_PROFILES, appPath, frameReport, markdownReport, parseScenarios, perfOrigin,
  renderDelta, streamingRenderReport, summarize,
} from './perf-baseline-lib.mjs'

const env = process.env
const TIMEOUT = Number(env.PERF_TIMEOUT_MS ?? 30_000)

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

async function newContext(browser, { storageState, perfFlag = false }) {
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } })
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

// ── cold start ──────────────────────────────────────────────────────────────
async function coldStart({ browser, origin, storageState, runs, throttleName }) {
  const chatPath = appPath(env.PERF_CHAT_PATH ?? '/app/chat')
  const samples = { ttfb: [], fcp: [], lcp: [], composerReady: [], transcriptPainted: [] }
  for (let run = 0; run < runs; run += 1) {
    const context = await newContext(browser, { storageState })
    try {
      const page = await context.newPage()
      await throttle(page, throttleName)
      await page.addInitScript(() => {
        window.__perfLcp = 0
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__perfLcp = entry.startTime
        }).observe({ type: 'largest-contentful-paint', buffered: true })
      })
      await page.goto(`${origin}${chatPath}`, { waitUntil: 'domcontentloaded' })
      assertSameOrigin(page, origin)
      await waitForMark(page, 'overlay:baseline:composer-ready')
      // Transcript paint only happens for an existing thread; tolerate its absence on /app/chat.
      await waitForMark(page, 'overlay:baseline:transcript-painted').catch(() => {})
      await page.waitForTimeout(500)
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0]
        const markAt = (name) => performance.getEntriesByName(name)[0]?.startTime ?? null
        return {
          ttfb: nav ? nav.responseStart : null,
          fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
          lcp: window.__perfLcp || null,
          composerReady: markAt('overlay:baseline:composer-ready'),
          transcriptPainted: markAt('overlay:baseline:transcript-painted'),
        }
      })
      for (const [key, value] of Object.entries(timing)) if (value != null) samples[key].push(value)
    } finally {
      await context.close()
    }
  }
  return { metrics: Object.fromEntries(Object.entries(samples).map(([key, values]) => [`${key}Ms`, summarize(values)])) }
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
    const target = row(page, name)
    await target.waitFor({ state: 'visible', timeout: TIMEOUT })
    return measureInteraction({
      stages: ['localFeedback', 'contentVisible'],
      trigger: () => target.getByText(name, { exact: true }).click({ timeout: TIMEOUT }),
      observers: {
        localFeedback: () => target.locator('[aria-current="page"]').waitFor({ state: 'visible', timeout: TIMEOUT }),
        contentVisible: () => page.getByText(sentinel, { exact: true }).first().waitFor({ state: 'visible', timeout: TIMEOUT }),
      },
    })
  }
  const push = (prefix, sample) => {
    if (sample.action !== 'completed') return
    const { localFeedback, contentVisible } = sample.stages
    if (localFeedback.status === 'observed') samples[`${prefix}Feedback`].push(localFeedback.ms)
    if (contentVisible.status === 'observed') samples[`${prefix}Content`].push(contentVisible.ms)
  }

  for (let run = 0; run < runs; run += 1) {
    const context = await newContext(browser, { storageState })
    try {
      const page = await context.newPage()
      await throttle(page, throttleName)
      // Start on a page where neither fixture thread is open, so B is cold.
      await page.goto(`${origin}${startPath}`, { waitUntil: 'domcontentloaded' })
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
  const prompt = env.PERF_PROMPT ?? 'Write a 600 word essay about the history of the printing press. Use several headings and a bulleted list.'
  const typed = env.PERF_TYPED_TEXT ?? 'the quick brown fox jumps over the lazy dog'
  const latencies = []
  const reports = []
  let renders = null

  for (let run = 0; run < runs; run += 1) {
    // Render counters add a little overhead, so only the first run enables them.
    const perfFlag = run === 0
    const context = await newContext(browser, { storageState, perfFlag })
    try {
      const page = await context.newPage()
      await throttle(page, throttleName)
      await page.goto(`${origin}${chatPath}`, { waitUntil: 'domcontentloaded' })
      assertSameOrigin(page, origin)
      await waitForMark(page, 'overlay:baseline:composer-ready')
      const input = page.locator('[data-chat-composer] [contenteditable="true"]').first()
      await input.waitFor({ state: 'visible', timeout: TIMEOUT })
      await input.click()
      await page.keyboard.type(prompt)
      await page.keyboard.press('Enter')

      // Streaming has started once a new assistant exchange is rendering text.
      await page.locator('[data-exchange-idx]').last().waitFor({ state: 'visible', timeout: TIMEOUT })
      await page.waitForTimeout(1_000)
      if (perfFlag) await page.evaluate(() => window.__overlayPerfDebug?.reset())

      await page.evaluate(() => {
        window.__perfKeyLatency = []
        document.addEventListener('keydown', (event) => {
          const start = event.timeStamp
          // Next frame after the input handlers ran: approximates keystroke -> paint.
          requestAnimationFrame(() => setTimeout(() => window.__perfKeyLatency.push(performance.now() - start), 0))
        }, { capture: true })
      })
      await input.click()
      for (const char of typed) {
        await page.keyboard.type(char)
        await page.waitForTimeout(80)
      }
      latencies.push(...await page.evaluate(() => window.__perfKeyLatency))

      if (perfFlag) {
        const snapshot = await page.evaluate(() => window.__overlayPerfDebug?.snapshot() ?? null)
        if (snapshot) {
          renders = renderDelta({}, snapshot.renders)
          reports.push(streamingRenderReport(renders))
        }
      }
      // Clear the draft so it is not sent; leave the reply to finish on its own.
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Backspace')
    } finally {
      await context.close()
    }
  }
  return {
    metrics: { keystrokeToFrameMs: summarize(latencies) },
    renders: renders ? { during: renders, report: reports[0] } : undefined,
  }
}

// ── DM scroll ──────────────────────────────────────────────────────────────
async function dmScroll({ browser, origin, storageState, runs, throttleName }) {
  const dmPath = appPath(required('PERF_DM_PATH'))
  const pages = Number(env.PERF_DM_LOAD_PAGES ?? 5)
  const fps = []
  const frameP75 = []
  const dropped = []
  const growth = []

  for (let run = 0; run < runs; run += 1) {
    const context = await newContext(browser, { storageState })
    try {
      const page = await context.newPage()
      await throttle(page, throttleName)
      await page.goto(`${origin}${dmPath}`, { waitUntil: 'domcontentloaded' })
      assertSameOrigin(page, origin)
      const rows = page.locator('[id^="room-message-"]')
      await rows.first().waitFor({ state: 'visible', timeout: TIMEOUT })
      const scroller = page.locator('[data-chat-transcript]').locator('xpath=..')
      const box = await scroller.boundingBox()
      if (!box) throw new Error('DM scroll container not found')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

      const domSize = () => page.evaluate(() => ({
        rows: document.querySelectorAll('[id^="room-message-"]').length,
        nodes: document.getElementsByTagName('*').length,
      }))
      const history = [await domSize()]
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
      for (let i = 0; i < pages; i += 1) {
        const before = history.at(-1).rows
        for (let step = 0; step < 15; step += 1) {
          await page.mouse.wheel(0, -600)
          await page.waitForTimeout(50)
        }
        // Wait for an older page to arrive (or give up: history may be fully loaded).
        await page.waitForFunction((count) => document.querySelectorAll('[id^="room-message-"]').length > count,
          before, { timeout: 5_000 }).catch(() => {})
        history.push(await domSize())
      }
      const frames = await page.evaluate(() => {
        window.__perfRecording = false
        return window.__perfFrames
      })
      const report = frameReport(frames)
      if (report.fps != null) fps.push(report.fps)
      if (report.frameP75 != null) frameP75.push(report.frameP75)
      dropped.push(report.droppedFrames)
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
      scrollDroppedFrames: summarize(dropped),
      domNodesPerRow: summarize(last.filter((point) => point.rows).map((point) => point.nodes / point.rows)),
    },
    domGrowth: last,
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
  const runs = Math.max(1, Number(env.PERF_RUNS ?? 5))
  const scenarios = parseScenarios(env.PERF_SCENARIOS)
  const outDir = path.resolve(env.PERF_OUT_DIR ?? '.perf')

  browser = await chromium.launch({
    headless: true,
    ...(env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  })
  const result = {
    revision: gitRevision(),
    originKind: origin.startsWith('http://') ? 'local' : 'preview',
    throttle: throttleName,
    runs,
    capturedAt: new Date().toISOString(),
    scenarios: {},
  }
  for (const scenario of scenarios) {
    console.error(`[perf-baseline] ${scenario}...`)
    try {
      result.scenarios[scenario] = await RUNNERS[scenario]({ browser, origin, storageState, runs, throttleName })
    } catch (error) {
      // Report the failure without page content, URLs or credentials.
      result.scenarios[scenario] = { error: error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'failed' }
      process.exitCode = 1
    }
  }
  await mkdir(outDir, { recursive: true })
  const stamp = result.capturedAt.replace(/[:.]/g, '-')
  await writeFile(path.join(outDir, `perf-baseline-${stamp}.json`), `${JSON.stringify(result, null, 2)}\n`)
  await writeFile(path.join(outDir, `perf-baseline-${stamp}.md`), markdownReport(result))
  console.log(markdownReport(result))
} catch (error) {
  console.error(`Perf baseline failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`)
  process.exitCode = 1
} finally {
  await browser?.close()
}
