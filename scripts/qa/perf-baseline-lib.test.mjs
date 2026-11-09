import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appPath, frameReport, markdownReport, parseScenarios, percentile, perfOrigin,
  renderDelta, streamingRenderReport, summarize,
} from './perf-baseline-lib.mjs'

test('only PR previews and loopback production servers are accepted', () => {
  assert.equal(perfOrigin('https://pr-12.preview.getoverlay.io/'), 'https://pr-12.preview.getoverlay.io')
  assert.equal(perfOrigin('http://localhost:3000'), 'http://localhost:3000')
  assert.equal(perfOrigin('http://127.0.0.1:4000/'), 'http://127.0.0.1:4000')
  for (const origin of [
    'https://getoverlay.io', 'https://www.getoverlay.io', 'http://pr-1.preview.getoverlay.io',
    'https://pr-1.preview.getoverlay.io.evil.com', 'https://localhost:3000', 'http://example.com',
    'http://user:secret@localhost:3000', 'http://localhost:3000/app', 'http://localhost:3000/?token=x',
  ]) {
    assert.throws(() => perfOrigin(origin), origin)
  }
})

test('app paths must be relative', () => {
  assert.equal(appPath('/app/chat?id=1'), '/app/chat?id=1')
  for (const value of ['https://x.io', '//x.io', '/\\x', '/a\nb', undefined]) assert.throws(() => appPath(value))
})

test('scenario selection rejects unknown names', () => {
  assert.equal(parseScenarios(undefined).length, 4)
  assert.deepEqual(parseScenarios('dm-scroll, cold-start'), ['dm-scroll', 'cold-start'])
  assert.throws(() => parseScenarios('cold-start,warp-speed'), /warp-speed/)
})

test('percentiles use nearest rank and ignore non-finite samples', () => {
  assert.equal(percentile([], 50), null)
  assert.equal(percentile([5], 75), 5)
  assert.equal(percentile([1, 2, 3, 4], 50), 2)
  assert.equal(percentile([4, 1, 3, 2], 75), 3)
  assert.equal(percentile([1, Number.NaN, 2, Infinity], 100), 2)
  assert.deepEqual(summarize([10, 20, 30, 40]), { n: 4, median: 20, p75: 30, max: 40 })
  assert.deepEqual(summarize([]), { n: 0, median: null, p75: null, max: null })
})

test('render deltas keep only components that rendered', () => {
  assert.deepEqual(
    renderDelta({ ChatExchange: 4, AppSidebar: 2 }, { ChatExchange: 10, AppSidebar: 2, ChatComposer: 3 }),
    { ChatComposer: 3, ChatExchange: 6 },
  )
})

test('streaming report normalizes renders per streamed update', () => {
  const report = streamingRenderReport({
    'ChatExchange(streaming)': 20, ChatExchange: 60, ChatComposer: 20, ChatTranscript: 20,
  })
  assert.equal(report.streamingUpdates, 20)
  assert.equal(report.settledExchangeRenders, 60)
  assert.equal(report.settledExchangeRendersPerUpdate, 3)
  assert.equal(report.composerRendersPerUpdate, 1)
  assert.equal(report.sidebarRendersPerUpdate, 0)
  assert.equal(streamingRenderReport({}).composerRendersPerUpdate, null)
})

test('frame report counts hitches over two 60 Hz frames', () => {
  const report = frameReport([0, 16, 32, 48, 100, 116])
  assert.equal(report.frames, 6)
  assert.equal(report.droppedFrames, 1)
  assert.equal(report.frameMax, 52)
  assert.equal(report.fps, 43.1)
  assert.equal(frameReport([1]).fps, null)
})

test('markdown report lists metrics, errors and render counts', () => {
  const markdown = markdownReport({
    revision: 'abc', originKind: 'local', throttle: 'none', runs: 1, capturedAt: 'now',
    scenarios: {
      'cold-start': { metrics: { composerReadyMs: { n: 1, median: 900, p75: 900, max: 900 } } },
      'dm-scroll': { error: 'PERF_DM_PATH is required for this scenario' },
      'typing-while-streaming': { metrics: {}, renders: { during: { ChatComposer: 1 } } },
    },
  })
  assert.match(markdown, /\| cold-start \| composerReadyMs \| 1 \| 900 \| 900 \| 900 \|/)
  assert.match(markdown, /dm-scroll \| error: PERF_DM_PATH/)
  assert.match(markdown, /### typing-while-streaming/)
})
