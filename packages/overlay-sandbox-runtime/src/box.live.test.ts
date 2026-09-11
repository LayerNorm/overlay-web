import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxSandboxRuntime } from './box'
import { isDesktopSandboxInstance, type SandboxInstance } from './contracts'

/**
 * Live smoke test against the real Box API — the computer-use surface the
 * shared conformance suite cannot cover (desktop streams, browser streams,
 * fork-carries-state). Gated behind the same flag as live conformance and
 * requires BOX_API_KEY.
 *
 * Run: OVERLAY_SANDBOX_LIVE_CONFORMANCE=1 BOX_API_KEY=… npm test
 */
const live = process.env.OVERLAY_SANDBOX_LIVE_CONFORMANCE === '1' && Boolean(process.env.BOX_API_KEY)

test('box desktop surface: webrtc + vnc tickets, port hosting, fork carries disk state', {
  skip: !live,
  timeout: 10 * 60_000,
}, async (t) => {
  const runtime = new BoxSandboxRuntime({ apiKey: process.env.BOX_API_KEY })
  const sandbox = await runtime.create({
    name: `overlay-live-desktop-${Date.now()}`,
    persistent: true,
    environment: { OVERLAY_TEST: 'live-desktop' },
    networkPolicy: { mode: 'allow_all' },
    idleTimeoutMs: 0,
    hardTimeoutMs: 30 * 60_000, // 30 min ttl ceiling for the test
    resources: { vcpus: 2, memoryGiB: 4, diskGiB: 40 },
  })
  let fork: SandboxInstance | null = null
  try {
    assert.ok(isDesktopSandboxInstance(sandbox))
    assert.equal(await sandbox.status(), 'running')

    // Commands + files + emulated env end to end.
    await sandbox.writeFiles([{ path: 'marker.txt', contents: new TextEncoder().encode('persist-me') }])
    const echo = await (await sandbox.runCommand({ command: 'echo', args: ['box-live'], timeoutMs: 15_000 })).wait()
    assert.equal(echo.exitCode, 0)
    assert.match(echo.stdout, /box-live/)
    await sandbox.updateEnvironment({ OVERLAY_LIVE_TOKEN: 'emulated' })
    const envCheck = await (await sandbox.runCommand({
      command: '/bin/sh',
      args: ['-c', 'printf "$OVERLAY_LIVE_TOKEN"'],
      timeoutMs: 15_000,
    })).wait()
    assert.match(envCheck.stdout, /emulated/)
    assert.ok((await sandbox.listFiles('/home/user')).some((entry) => entry.path.endsWith('marker.txt')))
    t.diagnostic('commands, files, emulated env OK')

    // Desktop streams: default webrtc, then vnc (first vnc open can provision).
    const webrtc = await sandbox.desktop({ theme: 'dark' })
    assert.equal(webrtc.ready, true)
    if (webrtc.ready) {
      assert.match(webrtc.url, /^https:\/\//)
      assert.equal(webrtc.mode, 'webrtc')
    }
    t.diagnostic('webrtc desktop ticket issued')

    let vnc = await sandbox.desktop({ mode: 'vnc' })
    for (let attempt = 0; attempt < 20 && !vnc.ready; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      vnc = await sandbox.desktop({ mode: 'vnc' })
    }
    assert.equal(vnc.ready, true)
    if (vnc.ready) assert.equal(vnc.mode, 'vnc')
    t.diagnostic('vnc desktop ticket issued')

    // Host a real port and fetch it through the token-gated URL.
    await sandbox.runCommand({
      command: '/bin/sh',
      args: ['-c', 'cd /home/user && nohup python3 -m http.server 8080 >/dev/null 2>&1 &'],
      timeoutMs: 10_000,
    })
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const port = await sandbox.port(8080)
    assert.equal(port.access, 'private')
    const served = await fetch(port.url)
    assert.equal(served.status, 200)
    t.diagnostic('hosted port reachable through token-gated url')

    // Stop → fork → the fork sees the marker file (disk state carried).
    await sandbox.stop()
    assert.equal(await sandbox.status(), 'stopped')
    fork = await sandbox.fork({ hardTimeoutMs: 600_000 })
    const forked = await fork.readFile('/home/user/marker.txt')
    assert.equal(Buffer.from(forked ?? []).toString(), 'persist-me')
    await fork.delete()
    fork = null
    t.diagnostic('fork carried disk state')

    // Resume the original; persistence holds across the whole cycle.
    await sandbox.resume()
    assert.equal(await sandbox.status(), 'running')
    assert.equal(Buffer.from((await sandbox.readFile('/home/user/marker.txt'))!).toString(), 'persist-me')
    t.diagnostic('stop/resume persistence verified')

    await sandbox.delete()
    assert.equal(await sandbox.status(), 'deleted')
  } finally {
    await fork?.delete().catch(() => undefined)
    await sandbox.delete().catch(() => undefined)
  }
})

test('box api rejects file paths outside the allowed roots', { skip: !live, timeout: 5 * 60_000 }, async (t) => {
  const runtime = new BoxSandboxRuntime({ apiKey: process.env.BOX_API_KEY })
  const sandbox = await runtime.create({
    name: `overlay-live-paths-${Date.now()}`,
    persistent: true,
    networkPolicy: { mode: 'allow_all' },
    idleTimeoutMs: 0,
    hardTimeoutMs: 600_000,
    resources: { vcpus: 2 },
  })
  try {
    await sandbox.writeFiles([{ path: '/etc/passwd', contents: new TextEncoder().encode('x') }])
      .then(() => assert.fail('write outside /home/user should be rejected'))
      .catch((error) => assert.equal(error.code, 'invalid_path'))
    assert.equal(await sandbox.readFile('/etc/shadow'), null)
    t.diagnostic('path boundary enforced')
  } finally {
    await sandbox.delete().catch(() => undefined)
  }
})
