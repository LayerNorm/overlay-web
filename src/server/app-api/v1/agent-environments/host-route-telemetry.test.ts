import assert from 'node:assert/strict'
import test from 'node:test'
import { SLOW_AGENT_HOST_REQUEST_MS, withAgentHostRouteTelemetry } from './host-route-telemetry'

function captureConsole() {
  const lines: Array<{ level: string; line: Record<string, unknown> }> = []
  const originals = { error: console.error, warn: console.warn, info: console.info, debug: console.debug }
  for (const level of ['error', 'warn', 'info', 'debug'] as const) {
    console[level] = (value: unknown) => { lines.push({ level, line: JSON.parse(String(value)) }) }
  }
  return { lines, restore: () => Object.assign(console, originals) }
}

test('a failed host request gets a request id header and one outcome line carrying the same id', async () => {
  const captured = captureConsole()
  try {
    const request = new Request('https://overlay.test/api/v1/agent-environments/env/events', { headers: { 'x-vercel-id': 'iad1::abc-123' } })
    let clock = 0
    const response = await withAgentHostRouteTelemetry('events.upload', request, async () => {
      clock = 42
      return new Response('{}', { status: 500 })
    }, () => clock)
    assert.equal(response.headers.get('x-overlay-request-id'), 'iad1::abc-123')
    assert.equal(captured.lines.length, 1)
    const [{ level, line }] = captured.lines
    assert.equal(level, 'error')
    assert.deepEqual(line.context, { hostRoute: 'events.upload', status: 500, durationMs: 42 })
    assert.equal((line.observability as Record<string, unknown>).requestId, 'iad1::abc-123')
  } finally { captured.restore() }
})

test('fast successful polls stay silent; slow ones and rejections are logged as warnings', async () => {
  const captured = captureConsole()
  try {
    const request = new Request('https://overlay.test/poll')
    let clock = 0
    await withAgentHostRouteTelemetry('commands.poll', request, async () => new Response('{}'), () => clock)
    assert.equal(captured.lines.length, 0)
    await withAgentHostRouteTelemetry('commands.poll', request, async () => { clock += SLOW_AGENT_HOST_REQUEST_MS; return new Response('{}') }, () => clock)
    await withAgentHostRouteTelemetry('heartbeat', request, async () => new Response('{}', { status: 429 }), () => clock)
    assert.deepEqual(captured.lines.map(({ level, line }) => [level, line.message]), [
      ['warn', '[agent-host] slow request'],
      ['warn', '[agent-host] request rejected'],
    ])
    assert.match(String((captured.lines[0]!.line.observability as Record<string, unknown>).requestId), /^[0-9a-f-]{36}$/)
  } finally { captured.restore() }
})
