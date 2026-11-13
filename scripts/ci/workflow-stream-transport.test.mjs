import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

async function exerciseStreamTransport() {
  const { createStreamer } = await import('@workflow/world-vercel')
  const payload = Buffer.from('Synthetic café 😀 stream bytes.')
  const attempts = new Map()
  const committed = new Map()
  const server = createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.split('/').at(-1)
    const attempt = (attempts.get(name) ?? 0) + 1
    attempts.set(name, attempt)
    request.on('error', () => {})
    const pieces = []
    request.on('data', piece => pieces.push(piece))
    request.on('end', () => {
      if (name === 'strm_throttled' && attempt === 1) return
      const bytes = Buffer.concat(pieces)
      committed.set(name, [...(committed.get(name) ?? []), bytes])
      // The append landed, but its acknowledgement was lost. It must not replay.
      response.writeHead(name === 'strm_uncertain' ? 500 : 200).end('fixture')
    })
    if (name === 'strm_throttled' && attempt === 1) {
      response.writeHead(429, { 'Retry-After': '0.001' }).end('fixture throttle')
    }
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    process.env.VERCEL_WORKFLOW_SERVER_URL = `http://127.0.0.1:${server.address().port}`
    const { streams } = createStreamer()
    await streams.write('wrun_fixture', 'strm_control', payload)
    assert.deepEqual(committed.get('strm_control'), [payload])
    await streams.write('wrun_fixture', 'strm_throttled', payload)
    assert.equal(attempts.get('strm_throttled'), 2)
    assert.deepEqual(committed.get('strm_throttled'), [payload])
    await assert.rejects(streams.write('wrun_fixture', 'strm_uncertain', payload))
    assert.equal(attempts.get('strm_uncertain'), 1)
    assert.deepEqual(committed.get('strm_uncertain'), [payload])
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

if (process.argv.includes('--transport-fixture')) {
  await exerciseStreamTransport()
} else {
  test('Workflow HTTP appends retry confirmed throttles intact, never ambiguous failures', { timeout: 20_000 }, () => {
    // Do not inherit deployment credentials or contact a hosted Workflow service.
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--transport-fixture'], {
      env: { PATH: process.env.PATH, WORKFLOW_NODE_HTTP: '0', WORKFLOW_STREAMS_TRANSPORT: 'http' },
      timeout: 15_000,
      encoding: 'utf8',
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
  })
}
