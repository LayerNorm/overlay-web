import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxApiError, BoxSandboxRuntime, type BoxFetch } from './box'
import { isDesktopSandboxInstance, type SandboxCreateRequest } from './contracts'

type RecordedCall = { method: string; url: string; body?: unknown; headers: Record<string, string> }

function recorder(handler: (call: RecordedCall) => Record<string, unknown>) {
  const calls: RecordedCall[] = []
  const fetchImpl: BoxFetch = async (url, init) => {
    const call: RecordedCall = {
      method: init.method ?? 'GET',
      url,
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers ?? {},
    }
    calls.push(call)
    const envelope = handler(call)
    return { status: envelope.ok === false ? (envelope.status as number) ?? 400 : 200, json: async () => envelope }
  }
  return { calls, fetch: fetchImpl }
}

const ok = (extra: Record<string, unknown> = {}) => ({ ok: true, ...extra })

function runtime(fetch: BoxFetch) {
  return new BoxSandboxRuntime({ apiKey: 'test-key', fetch })
}

function request(name = 'overlay-box'): SandboxCreateRequest {
  return {
    name,
    persistent: true,
    environment: { OVERLAY_WORKSPACE_ID: 'ws-1' },
    networkPolicy: { mode: 'allow_all' },
    idleTimeoutMs: 120_000,
    hardTimeoutMs: 600_000,
    resources: { vcpus: 2, memoryGiB: 4, diskGiB: 40 },
  }
}

test('create always provisions no-env, maps size and ttl, and sets the name via PATCH', async () => {
  const { calls, fetch } = recorder(() => ({ ok: true, type: 'box.created', box: { id: 'bx_new', state: 'ready' } }))
  const instance = await runtime(fetch).create(request('computer-1'))

  const create = calls[0]
  assert.equal(create.method, 'POST')
  assert.match(create.url, /\/boxes$/)
  assert.deepEqual(create.body, {
    type: 'small',
    ttlSeconds: 600,
    env: { OVERLAY_WORKSPACE_ID: 'ws-1' },
    noEnv: true,
  })
  assert.equal(create.headers['Idempotency-Key']?.length, 36)
  assert.equal(create.headers.Authorization, 'Bearer test-key')

  const patch = calls[1]
  assert.equal(patch.method, 'PATCH')
  assert.deepEqual(patch.body, { name: 'computer-1' })
  assert.equal(instance.provider, 'box')
  assert.equal(instance.reference, 'bx_new')
  assert.equal(await instance.status(), 'running')
})

test('create maps default/large sizes and infinite ttl, and restore uses from', async () => {
  const { calls, fetch } = recorder(() => ({ ok: true, box: { id: 'bx_1', state: 'ready' } }))
  const rt = runtime(fetch)
  await rt.create({ ...request(), hardTimeoutMs: 0, resources: { vcpus: 4 } })
  assert.deepEqual(calls[0].body, { type: 'default', ttlSeconds: null, env: { OVERLAY_WORKSPACE_ID: 'ws-1' }, noEnv: true })

  await rt.restore('golden-image', { ...request(), resources: { vcpus: 8 } })
  const restoreCreate = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/boxes')).at(-1)!
  assert.equal((restoreCreate.body as Record<string, unknown>).type, 'large')
  assert.equal((restoreCreate.body as Record<string, unknown>).from, 'golden-image')
})

test('create refuses network policies and credential bindings the provider lacks', async () => {
  const { fetch } = recorder(() => ok())
  const rt = runtime(fetch)
  await assert.rejects(
    rt.create({ ...request(), networkPolicy: { mode: 'deny_all' } }),
    (error) => error instanceof BoxApiError && error.code === 'unsupported',
  )
  await assert.rejects(
    rt.create({ ...request(), credentials: [{ brokerRef: 'b', environmentVariable: 'E', allowedDomains: [] }] }),
    (error) => error instanceof BoxApiError && error.code === 'unsupported',
  )
})

test('error envelopes surface status, code, and requestId', async () => {
  const { fetch } = recorder(() => ({
    ok: false,
    status: 409,
    code: 'box_starting',
    message: 'box is still starting',
    requestId: 'req_123',
    error: { code: 'box_starting', message: 'box is still starting', status: 409 },
  }))
  const rt = runtime(fetch)
  await assert.rejects(rt.getBox('bx_x'), (error) => {
    assert.ok(error instanceof BoxApiError)
    assert.equal(error.status, 409)
    assert.equal(error.code, 'box_starting')
    assert.equal(error.requestId, 'req_123')
    return true
  })
})

test('lifecycle: status maps box states, delete requires the confirm header, 404 reads deleted', async () => {
  let deleted = false
  const { calls, fetch } = recorder((call) => {
    if (call.method === 'DELETE') { deleted = true; return ok({ type: 'deletion.accepted' }) }
    if (call.url.includes('/boxes/bx_1')) {
      if (deleted) return { ok: false, status: 404, code: 'not_found', error: { code: 'not_found', status: 404 } }
      return ok({ box: { id: 'bx_1', state: 'ready' } })
    }
    return ok()
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  await instance.delete()

  const remove = calls.find((call) => call.method === 'DELETE')
  assert.equal(remove?.headers['X-Ascii-Confirm-Delete'], 'bx_1')
  assert.equal(await instance.status(), 'deleted')
})

test('reconnect resumes an archived box', async () => {
  let state = 'archived'
  const { calls, fetch } = recorder((call) => {
    if (call.url.endsWith('/resume')) { state = 'ready'; return ok({ type: 'box.resuming' }) }
    return ok({ box: { id: 'bx_1', state } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  assert.ok(calls.some((call) => call.url.endsWith('/resume')))
  assert.equal(await instance.status(), 'running')
})

test('commands run detached, stream log deltas, and resolve with exit code', async () => {
  let polls = 0
  const { calls, fetch } = recorder((call) => {
    if (call.url.endsWith('/commands') && call.method === 'POST') {
      return ok({ processId: 7, pid: 4242 })
    }
    if (call.url.endsWith('/commands/7')) {
      polls += 1
      return ok(polls === 1
        ? { processId: 7, running: true, status: 'running', stdout: 'hel', stderr: '' }
        : { processId: 7, running: false, status: 'exited', exitCode: 0, stdout: 'hello', stderr: 'warn' })
    }
    return ok({ box: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const handle = await instance.runCommand({ command: 'echo', args: ['hello world'], timeoutMs: 10_000 })

  const commandCall = calls.find((call) => call.url.endsWith('/commands') && call.method === 'POST')!
  assert.equal((commandCall.body as Record<string, unknown>).detached, true)
  assert.match((commandCall.body as Record<string, unknown>).command as string, /echo 'hello world'/)

  let streamed = ''
  const consume = (async () => { for await (const event of handle.events()) streamed += event.data })()
  const result = await handle.wait()
  await consume
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, 'hello')
  assert.match(streamed, /hel/)
})

test('cancel kills the detached process by pid', async () => {
  const { calls, fetch } = recorder((call) => {
    if (call.url.endsWith('/commands') && call.method === 'POST') {
      const body = call.body as { command: string }
      if (body.command.startsWith('kill')) return ok({ processId: 8, pid: 1 })
      return ok({ processId: 7, pid: 4242 })
    }
    if (call.url.endsWith('/commands/7')) {
      return ok({ processId: 7, running: false, status: 'exited', exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' })
    }
    return ok({ box: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const handle = await instance.runCommand({ command: 'sleep', args: ['30'], timeoutMs: 60_000 })
  await handle.cancel()
  const kill = calls.find((call) => (call.body as { command?: string })?.command?.startsWith('kill'))
  assert.equal((kill?.body as { command: string }).command, 'kill -TERM 4242')
  assert.notEqual((await handle.wait()).exitCode, 0)
})

test('emulated environment prefixes every subsequent command', async () => {
  const { calls, fetch } = recorder((call) => {
    if (call.url.endsWith('/commands') && call.method === 'POST') return ok({ processId: 1, pid: 1 })
    if (call.url.includes('/commands/1')) return ok({ running: false, status: 'exited', exitCode: 0, stdout: '', stderr: '' })
    return ok({ box: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  await instance.updateEnvironment({ OVERLAY_TOKEN: "it's" }, ['STALE'])
  await (await instance.runCommand({ command: 'env', timeoutMs: 5_000 })).wait()
  const command = (calls.find((call) => call.url.endsWith('/commands'))?.body as { command: string }).command
  assert.match(command, /^env OVERLAY_TOKEN='it'\\''s' env$/)
  assert.doesNotMatch(command, /STALE/)
})

test('files write base64, read base64, and missing files read as null', async () => {
  const { calls, fetch } = recorder((call) => {
    if (call.method === 'PUT') return ok({ type: 'file.write' })
    if (call.url.includes('missing')) return { ok: false, status: 400, code: 'invalid_path', error: { code: 'invalid_path', status: 400 } }
    if (call.method === 'GET' && call.url.includes('/files')) {
      return ok({ content: Buffer.from('overlay').toString('base64'), encoding: 'base64' })
    }
    return ok({ box: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  await instance.writeFiles([{ path: '/home/user/a.txt', contents: new TextEncoder().encode('overlay') }])
  assert.equal((calls.find((call) => call.method === 'PUT')?.body as { content: string }).content, 'b3ZlcmxheQ==')
  assert.equal(Buffer.from((await instance.readFile('/home/user/a.txt'))!).toString(), 'overlay')
  assert.equal(await instance.readFile('/home/user/missing'), null)
})

test('listFiles emulates via find and parses kinds', async () => {
  const { fetch } = recorder((call) => {
    if (call.url.endsWith('/commands') && call.method === 'POST') return ok({ processId: 2, pid: 5 })
    if (call.url.includes('/commands/2')) {
      return ok({ running: false, status: 'exited', exitCode: 0, stderr: '', stdout: 'd\t4096\t/home/user/sub\nf\t7\t/home/user/a.txt\nl\t9\t/home/user/link\n' })
    }
    return ok({ box: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const entries = await instance.listFiles('/home/user')
  assert.deepEqual(entries, [
    { path: '/home/user/sub', kind: 'directory', size: 4096 },
    { path: '/home/user/a.txt', kind: 'file', size: 7 },
    { path: '/home/user/link', kind: 'symlink', size: 9 },
  ])
})

test('desktop returns ready ticket, vnc mode, and provisioning ticket', async () => {
  let provisioning = true
  const { calls, fetch } = recorder((call) => {
    if (call.url.includes('/desktop')) {
      if (provisioning) { provisioning = false; return ok({ type: 'desktop.provisioning', provisioning: true }) }
      return ok({ type: 'desktop.url', desktopUrl: 'https://stream.example/vnc.html?_token=x', mode: 'vnc' })
    }
    return ok({ box: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  assert.ok(isDesktopSandboxInstance(instance))
  const first = await instance.desktop({ mode: 'vnc', theme: 'dark' })
  assert.equal(first.ready, false)
  const second = await instance.desktop({ mode: 'vnc', theme: 'dark' })
  assert.deepEqual(second, { ready: true, url: 'https://stream.example/vnc.html?_token=x', mode: 'vnc' })
  const desktopCall = calls.find((call) => call.url.includes('/desktop'))!
  assert.match(desktopCall.url, /vnc=1/)
  assert.match(desktopCall.url, /theme=dark/)
})

test('fork returns a new instance over a fresh box id', async () => {
  const { calls, fetch } = recorder((call) => {
    if (call.url.endsWith('/fork')) return ok({ type: 'box.forking', id: 'bx_fork' })
    if (call.url.includes('bx_fork')) return ok({ box: { id: 'bx_fork', state: 'ready' } })
    return ok({ box: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  assert.ok(isDesktopSandboxInstance(instance))
  const fork = await instance.fork({ environment: { OVERLAY_AGENT_ID: 'ag-1' }, hardTimeoutMs: 60_000 })
  assert.notEqual(fork.reference, 'bx_1')
  assert.equal(fork.reference, 'bx_fork')
  assert.equal((calls.find((call) => call.url.endsWith('/fork'))?.body as { ttlSeconds: number }).ttlSeconds, 60)
})

test('stop polls until archived and delete is idempotent', async () => {
  let state = 'ready'
  const { fetch } = recorder((call) => {
    if (call.url.endsWith('/stop')) { state = 'archived'; return ok({ type: 'box.stopping' }) }
    if (call.method === 'DELETE') return ok()
    return ok({ box: { id: 'bx_1', state } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  await instance.stop()
  assert.equal(await instance.status(), 'stopped')
  await instance.delete()
  await instance.delete()
  assert.equal(await instance.status(), 'deleted')
})

test('snapshot saves a named snapshot and deleteSnapshot removes it', async () => {
  let saved = false
  const { calls, fetch } = recorder((call) => {
    if (call.url.endsWith('/named-snapshots') && call.method === 'POST') { saved = true; return ok({ status: 'saving' }) }
    if (call.url.includes('/named-snapshots/overlay-')) {
      if (call.method === 'DELETE') return ok()
      return ok({ snapshot: { status: saved ? 'ready' : 'saving' } })
    }
    return ok({ box: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const snapshot = await instance.snapshot()
  assert.match(snapshot.id, /^overlay-bx_1-/)
  assert.equal((calls.find((call) => call.url.endsWith('/named-snapshots'))?.body as { boxId: string }).boxId, 'bx_1')
  await runtime(fetch).deleteSnapshot(snapshot.id)
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.url.includes(snapshot.id)))
})

test('port returns a token-gated private url', async () => {
  const { fetch } = recorder((call) => {
    if (call.url.endsWith('/host')) return ok({ url: 'https://x-3000.on.ascii.dev?_token=t' })
    return ok({ box: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const port = await instance.port(3000)
  assert.equal(port.access, 'private')
  assert.match(port.url, /_token=/)
})

test('constructor refuses a missing api key', () => {
  const saved = process.env.BOX_API_KEY
  delete process.env.BOX_API_KEY
  try {
    assert.throws(() => new BoxSandboxRuntime({ fetch: async () => { throw new Error('unreachable') } }), /BOX_API_KEY/)
  } finally {
    if (saved) process.env.BOX_API_KEY = saved
  }
})
