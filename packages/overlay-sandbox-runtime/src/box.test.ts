import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, writeFileSync, statSync, rmSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import { BoxApiError, BoxSandboxRuntime, boatApiKeyFromEnv, type BoxFetch } from './box'
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

test('create always provisions no-env, maps size and bounded ttl, and sets the name via PATCH', async () => {
  const { calls, fetch } = recorder(() => ({ ok: true, type: 'sandbox.created', sandbox: { id: 'bx_new', state: 'ready' } }))
  const instance = await runtime(fetch).create(request('computer-1'))

  const create = calls[0]
  assert.equal(create.method, 'POST')
  assert.match(create.url, /\/sandboxes$/)
  assert.deepEqual(create.body, {
    type: 'small',
    ttlSeconds: 240,
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

test('a scoped Boat environment stays attached without injecting account credentials', async () => {
  const { calls, fetch } = recorder(() => ({ ok: true, sandbox: { id: 'bx_preview', state: 'ready' } }))
  const rt = new BoxSandboxRuntime({ apiKey: 'preview-key', environment: 'overlay-preview', fetch })
  await rt.create(request())
  assert.deepEqual(calls[0].body, {
    type: 'small', ttlSeconds: 240, env: { OVERLAY_WORKSPACE_ID: 'ws-1' },
    noEnv: true, environment: 'overlay-preview',
  })
})

test('inventory requests bounded live states and cost, filters environment, and returns only safe fields', async () => {
  const { calls, fetch } = recorder(() => ok({
    sandboxes: [
      {
        id: 'bx_preview', state: 'ready', environment: 'overlay-preview',
        createdAt: '2026-10-01T00:00:00.000Z', cost: { dollars: 1.23 },
        url: 'https://machine.invalid', ip: '192.0.2.1', sshEndpoint: 'machine.invalid:22',
        desktopUrl: 'https://secret.invalid',
      },
      { id: 'bx_other', state: 'running', environment: 'production', createdAt: '2026-10-01T00:00:00.000Z' },
    ],
    pageInfo: { nextCursor: 'cursor-next', hasMore: true, limit: 17 },
  }))
  const rt = new BoxSandboxRuntime({ apiKey: 'preview-key', environment: 'overlay-preview', fetch })

  const inventory = await rt.listInventory({ cursor: 'cursor-current', limit: 17 })
  const url = new URL(calls[0]!.url)
  assert.equal(calls[0]!.method, 'GET')
  assert.equal(url.pathname, '/api/v1/sandboxes')
  assert.equal(url.searchParams.get('limit'), '17')
  assert.equal(url.searchParams.get('cursor'), 'cursor-current')
  assert.equal(url.searchParams.get('state'), 'init,provisioning,provisioned,cloning,ready,idle,running,archiving')
  assert.equal(url.searchParams.get('include'), 'cost')
  assert.equal(inventory.nextCursor, 'cursor-next')
  assert.deepEqual(inventory.items, [{
    reference: 'bx_preview',
    state: 'ready',
    createdAt: Date.parse('2026-10-01T00:00:00.000Z'),
    monthCostCents: 123,
  }])
  for (const key of ['url', 'ip', 'sshEndpoint', 'desktopUrl']) {
    assert.equal(Object.hasOwn(inventory.items[0]!, key), false)
  }
})

test('inventory includes all environments when no Boat environment is configured', async () => {
  const { fetch } = recorder(() => ok({
    sandboxes: [
      { id: 'bx_one', state: 'ready', environment: 'one' },
      { id: 'bx_two', state: 'idle', environment: 'two' },
    ],
  }))
  const inventory = await runtime(fetch).listInventory({ limit: 200 })
  assert.deepEqual(inventory.items.map((item) => item.reference), ['bx_one', 'bx_two'])
})

test('create maps default/large sizes and bounded ttl, and restore uses from', async () => {
  const { calls, fetch } = recorder(() => ({ ok: true, sandbox: { id: 'bx_1', state: 'ready' } }))
  const rt = runtime(fetch)
  await rt.create({ ...request(), hardTimeoutMs: 0, resources: { vcpus: 4 } })
  assert.deepEqual(calls[0].body, { type: 'default', ttlSeconds: 240, env: { OVERLAY_WORKSPACE_ID: 'ws-1' }, noEnv: true })

  await rt.restore('golden-image', { ...request(), resources: { vcpus: 8 } })
  const restoreCreate = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/sandboxes')).at(-1)!
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

test('allocation is persisted before readiness and failures neither delete nor retry the provider', async () => {
  const events: string[] = []
  const { calls, fetch } = recorder((call) => {
    events.push(call.method)
    return ok({ sandbox: { id: 'bx_claimed', state: 'error' } })
  })
  await assert.rejects(runtime(fetch).create({
    ...request(), allocationKey: 'durable-allocation-1',
    onAllocated: async (reference) => { assert.equal(reference, 'bx_claimed'); events.push('persisted') },
  }), /entered error state/)
  assert.deepEqual(events.slice(0, 2), ['POST', 'persisted'])
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  assert.equal(calls.some((call) => call.method === 'DELETE'), false)
  assert.equal(calls[0].headers['Idempotency-Key'], 'durable-allocation-1')
})

test('failed allocation persistence stops setup and stable retries preserve the exact provider request', async () => {
  const { calls, fetch } = recorder(() => ok({ sandbox: { id: 'bx_claimed', state: 'ready' } }))
  const rt = runtime(fetch)
  const args = { ...request(), allocationKey: 'durable-allocation-1' }
  await assert.rejects(rt.create({ ...args, onAllocated: async () => { throw new Error('database unavailable') } }), /database unavailable/)
  assert.equal(calls.length, 1)
  await rt.create(args)
  const creates = calls.filter((call) => call.method === 'POST')
  assert.equal(creates.length, 2)
  assert.deepEqual(creates[0].body, creates[1].body)
  assert.equal(creates[0].headers['Idempotency-Key'], creates[1].headers['Idempotency-Key'])
})

test('runtime renewal never disables or extends the four minute provider fence', async () => {
  const { calls, fetch } = recorder(() => ok({ sandbox: { id: 'bx_fenced', state: 'ready' } }))
  const instance = await runtime(fetch).reconnect('bx_fenced', { resume: false })
  await instance.renewRuntime!(60 * 60_000)
  assert.deepEqual(calls.at(-1)?.body, { ttlSeconds: 240 })
  await assert.rejects(instance.renewRuntime!(Number.NaN), /must be positive/)
})

test('base URL cleanup removes a long trailing slash suffix before provider requests', async () => {
  const {fetch, calls} = recorder(() => ok())
  const instance = new BoxSandboxRuntime({apiKey: 'test-key', baseUrl: 'https://boat.invalid' + '/'.repeat(200000), fetch})
  await instance.request('GET', '/v1/boxes')
  assert.equal(calls[0]?.url, 'https://boat.invalid/v1/boxes')
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
    if (call.url.includes('/sandboxes/bx_1')) {
      if (deleted) return { ok: false, status: 404, code: 'not_found', error: { code: 'not_found', status: 404 } }
      return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
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
    return ok({ sandbox: { id: 'bx_1', state } })
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
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const handle = await instance.runCommand({ command: 'echo', args: ['hello world'], timeoutMs: 10_000 })

  const commandCall = calls.find((call) => call.url.endsWith('/commands') && call.method === 'POST')!
  assert.equal((commandCall.body as Record<string, unknown>).detached, true)
  assert.match((commandCall.body as Record<string, unknown>).command as string, /^timeout --signal=TERM --kill-after=5s 10s sh -c /)
  assert.match((commandCall.body as Record<string, unknown>).command as string, /hello world/)

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
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
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
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  await instance.updateEnvironment({ OVERLAY_TOKEN: "it's" }, ['STALE'])
  await (await instance.runCommand({ command: 'env', timeoutMs: 5_000 })).wait()
  const command = (calls.find((call) => call.url.endsWith('/commands'))?.body as { command: string }).command
  assert.match(command, /^timeout --signal=TERM --kill-after=5s 5s sh -c /)
  assert.match(command, /env OVERLAY_TOKEN=.* sh -c .*env/)
  assert.doesNotMatch(command, /STALE/)
})

test('command environments wrap compound shell commands and preserve argument quoting', async () => {
  const { calls, fetch } = recorder((call) => call.url.endsWith('/commands')
    ? ok({ processId: 7, pid: 70 })
    : ok({ sandbox: { id: 'bx_1', state: 'ready' } }))
  const instance = await runtime(fetch).reconnect('bx_1')

  await instance.runCommand({
    command: 'for d in a b; do printf "%s:%s\\n" "$d" "$LOOP_VALUE"; done',
    environment: { LOOP_VALUE: 'visible' },
    timeoutMs: 0,
  })
  const loopCommand = (calls.find((call) => call.url.endsWith('/commands'))?.body as { command: string }).command
  assert.match(loopCommand, /^env LOOP_VALUE='visible' sh -c 'for d in a b; do /)
  assert.equal(
    execFileSync('/bin/sh', ['-c', loopCommand], { encoding: 'utf8' }),
    'a:visible\nb:visible\n',
  )

  await instance.runCommand({
    command: 'printf',
    args: ['%s\\n', 'two words'],
    environment: { ARG_VALUE: 'quoted' },
    timeoutMs: 0,
  })
  const argsCommand = (calls.filter((call) => call.url.endsWith('/commands'))[1]?.body as { command: string }).command
  assert.match(argsCommand, /^env ARG_VALUE='quoted' sh -c 'printf /)
  assert.equal(
    execFileSync('/bin/sh', ['-c', argsCommand], { encoding: 'utf8' }),
    'two words\n',
  )
})

test('files write base64, read base64, and missing files read as null', async () => {
  const { calls, fetch } = recorder((call) => {
    if (call.method === 'PUT') return ok({ type: 'file.write' })
    if (call.url.includes('missing')) return { ok: false, status: 400, code: 'invalid_path', error: { code: 'invalid_path', status: 400 } }
    if (call.method === 'GET' && call.url.includes('/files')) {
      return ok({ content: Buffer.from('overlay').toString('base64'), encoding: 'base64' })
    }
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  await instance.writeFiles([{ path: '/home/user/a.txt', contents: new TextEncoder().encode('overlay') }])
  assert.equal((calls.find((call) => call.method === 'PUT')?.body as { content: string }).content, 'b3ZlcmxheQ==')
  assert.equal(Buffer.from((await instance.readFile('/home/user/a.txt'))!).toString(), 'overlay')
  assert.equal(await instance.readFile('/home/user/missing'), null)
})

test('file modes are applied through the command channel and never put file contents in command arguments', {skip: process.platform === 'win32' ? 'Boat is a POSIX machine' : false}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'boat-file-mode-')), path = join(directory, 'file with spaces; literal')
  const {calls, fetch} = recorder(call => {
    if (call.method === 'PUT') {
      const body = call.body
      assert.ok(body && typeof body === 'object' && 'path' in body && typeof body.path === 'string' && 'content' in body && typeof body.content === 'string')
      writeFileSync(body.path, Buffer.from(body.content, 'base64'))
    }
    if (call.method === 'POST' && call.url.endsWith('/commands')) {
      const body = call.body
      assert.ok(body && typeof body === 'object' && 'command' in body && typeof body.command === 'string')
      execFileSync('bash', ['-c', body.command])
      return ok({processId: 11, pid: 12})
    }
    if (call.url.includes('/commands/11')) return ok({running: false, status: 'exited', exitCode: 0, stdout: '', stderr: ''})
    return ok({sandbox: {id: 'bx_1', state: 'ready'}})
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const content = 'never-put-file-content-in-argv'
  try {
    for (const mode of [0o600, 0o755, 0]) {
      await instance.writeFiles([{path, contents: Buffer.from(content), mode}])
      assert.equal(statSync(path).mode & 0o777, mode)
    }
    const commands = calls.filter(call => call.method === 'POST' && call.url.endsWith('/commands'))
    assert.equal(commands.length, 3)
    assert.ok(commands.every(command => !JSON.stringify(command.body).includes(content)))
    const before = calls.length
    await assert.rejects(instance.writeFiles([{path: '/home/user/no-write', contents: Buffer.from(content), mode: 0o1000}]),
      error => error instanceof BoxApiError && error.code === 'invalid_file_mode')
    assert.equal(calls.length, before)
  } finally {rmSync(directory, {recursive: true, force: true})}
})

test('failed permission changes make file delivery fail without disclosing its contents', async () => {
  const {fetch} = recorder(call => {
    if (call.method === 'POST' && call.url.endsWith('/commands')) return ok({processId: 11, pid: 12})
    if (call.url.includes('/commands/11')) return ok({running: false, status: 'exited', exitCode: 1, stdout: 'private file bytes', stderr: 'permission denied'})
    return ok({sandbox: {id: 'bx_1', state: 'ready'}})
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  await assert.rejects(instance.writeFiles([{path: '/home/user/private.json', contents: Buffer.from('private file bytes'), mode: 0o600}]),
    error => error instanceof BoxApiError && error.code === 'file_permissions_failed' && !error.message.includes('private file bytes'))
})

test('listFiles emulates via find and parses kinds', async () => {
  const { fetch } = recorder((call) => {
    if (call.url.endsWith('/commands') && call.method === 'POST') return ok({ processId: 2, pid: 5 })
    if (call.url.includes('/commands/2')) {
      return ok({ running: false, status: 'exited', exitCode: 0, stderr: '', stdout: 'd\t4096\t/home/user/sub\nf\t7\t/home/user/a.txt\nl\t9\t/home/user/link\n' })
    }
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
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
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
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
    if (call.url.includes('bx_fork')) return ok({ sandbox: { id: 'bx_fork', state: 'ready' } })
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
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
    return ok({ sandbox: { id: 'bx_1', state } })
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
    if (call.url.includes('/named-snapshots/ov-')) {
      if (call.method === 'DELETE') return ok()
      return ok({ snapshot: { status: saved ? 'ready' : 'saving' } })
    }
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const snapshot = await instance.snapshot()
  assert.match(snapshot.id, /^ov-bx1-/)
  assert.equal((calls.find((call) => call.url.endsWith('/named-snapshots'))?.body as { sandboxId: string }).sandboxId, 'bx_1')
  await runtime(fetch).deleteSnapshot(snapshot.id)
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.url.includes(snapshot.id)))
})

test('port returns a token-gated private url', async () => {
  const { fetch } = recorder((call) => {
    if (call.url.endsWith('/host')) return ok({ url: 'https://x-3000.on.boat.dev?_token=t' })
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const port = await instance.port(3000)
  assert.equal(port.access, 'private')
  assert.match(port.url, /_token=/)
})

test('create does not retry or delete when a box enters error during provisioning', async () => {
  let creates = 0
  const { calls, fetch } = recorder((call) => {
    if (call.method === 'POST' && call.url.endsWith('/sandboxes')) {
      creates += 1
      return ok({ sandbox: { id: creates === 1 ? 'bx_bad' : 'bx_good', state: 'ready' } })
    }
    if (call.method === 'DELETE') return ok()
    if (call.url.includes('bx_bad')) return ok({ sandbox: { id: 'bx_bad', state: 'error' } })
    return ok({ sandbox: { id: 'bx_good', state: 'ready' } })
  })
  await assert.rejects(runtime(fetch).create(request('retry')), (error: unknown) =>
    error instanceof BoxApiError && error.code === 'box_error')
  assert.equal(creates, 1)
  assert.equal(calls.some((call) => call.method === 'DELETE' && call.url.includes('bx_bad')), false)
})

test('usage reports billable machine seconds as wallTime plus provider dollars', async () => {
  const { calls, fetch } = recorder((call) => {
    if (call.url.endsWith('/usage')) {
      return ok({
        type: 'box.usage',
        seconds: 3605,
        dollars: 0.03605,
        secondsPerDollar: 100000,
        billingMultiplier: 0.5,
        running: false,
      })
    }
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  const usage = await instance.usage()
  assert.equal(usage.wallTimeMs, 3_605_000)
  assert.equal(usage.providerMetrics?.reportedUsd, 0.03605)
  assert.equal(usage.providerMetrics?.secondsPerDollar, 100000)
  assert.equal(usage.providerMetrics?.billingMultiplier, 0.5)
  assert.equal(usage.providerMetrics?.running, false)
  assert.match(calls.find((call) => call.url.includes('/usage'))!.url, /\/sandboxes\/bx_1\/usage$/)
})

test('usage rejects counters missing provider dollars', async () => {
  const { fetch } = recorder((call) => {
    if (call.url.endsWith('/usage')) return ok({
      seconds: 120, secondsPerDollar: 100_000, billingMultiplier: 1, running: true,
    })
    return ok({ sandbox: { id: 'bx_1', state: 'ready' } })
  })
  const instance = await runtime(fetch).reconnect('bx_1')
  await assert.rejects(instance.usage(), (error: unknown) =>
    error instanceof BoxApiError && error.code === 'invalid_usage_response')
})

test('limits reads account capacity and balance', async () => {
  const { calls, fetch } = recorder((call) => {
    if (call.url.endsWith('/limits')) {
      return ok({
        canStart: true,
        blockedReason: null,
        subscriptionRemainingSeconds: 1_966_166,
        creditBalanceSeconds: 0,
        last24hUsageSeconds: 3605,
        activeSandboxes: 2,
        maxActiveSandboxes: 100,
      })
    }
    return ok()
  })
  const limits = await runtime(fetch).limits()
  assert.equal(limits.canStart, true)
  assert.equal(limits.remainingSeconds, 1_966_166)
  assert.equal(limits.last24hUsageSeconds, 3605)
  assert.equal(limits.activeSandboxes, 2)
  assert.equal(limits.maxActiveSandboxes, 100)
  assert.match(calls[0].url, /\/limits$/)
})

test('constructor refuses a missing api key', () => {
  const saved = { boat: process.env.BOAT_API_KEY, box: process.env.BOX_API_KEY }
  delete process.env.BOAT_API_KEY
  delete process.env.BOX_API_KEY
  try {
    assert.throws(() => new BoxSandboxRuntime({ fetch: async () => { throw new Error('unreachable') } }), /BOAT_API_KEY/)
  } finally {
    if (saved.boat) process.env.BOAT_API_KEY = saved.boat
    if (saved.box) process.env.BOX_API_KEY = saved.box
  }
})

test('BOAT_API_KEY wins over the legacy BOX_API_KEY, which still works alone', () => {
  assert.equal(boatApiKeyFromEnv({ BOAT_API_KEY: 'boat_new', BOX_API_KEY: 'box_old' }), 'boat_new')
  assert.equal(boatApiKeyFromEnv({ BOX_API_KEY: 'box_old' }), 'box_old')
  assert.equal(boatApiKeyFromEnv({ BOAT_API_KEY: '  ', BOX_API_KEY: 'box_old' }), 'box_old')
  assert.equal(boatApiKeyFromEnv({}), undefined)
})

test('requests go to the Boat API by default', async () => {
  const { calls, fetch } = recorder(() => ok({ sandbox: { id: 'bx_1', state: 'ready' } }))
  await runtime(fetch).reconnect('bx_1')
  assert.equal(calls[0]!.url, 'https://boat.dev/api/v1/sandboxes/bx_1')
})

test('legacy box envelopes are still read', async () => {
  const { fetch } = recorder(() => ok({ box: { id: 'bx_legacy', state: 'ready' } }))
  const instance = await runtime(fetch).create(request())
  assert.equal(instance.reference, 'bx_legacy')
})

test('a command environment is applied on top of the machine environment', async () => {
  const { calls, fetch } = recorder((call) => call.url.endsWith('/commands')
    ? ok({ processId: 7, pid: 70 })
    : ok({ sandbox: { id: 'bx_1', state: 'ready' } }))
  const instance = await runtime(fetch).reconnect('bx_1')
  await instance.updateEnvironment({ SHARED: 'machine', OVERRIDE: 'machine' })
  await instance.runCommand({ command: 'printenv', environment: { OVERRIDE: 'command', ONLY: 'command' }, timeoutMs: 1_000 })
  const command = (calls.find((call) => call.url.endsWith('/commands'))?.body as { command: string }).command
  assert.match(command, /^timeout --signal=TERM --kill-after=5s 1s sh -c /)
  assert.match(command, /env SHARED=.*OVERRIDE=.*ONLY=.* sh -c .*printenv/)
})
