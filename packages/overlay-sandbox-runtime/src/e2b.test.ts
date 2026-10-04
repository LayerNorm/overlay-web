import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { runSandboxConformance } from './conformance'
import {
  E2BSandboxRuntime,
  type E2BCommandHandle,
  type E2BSandboxClass,
  type E2BSandboxHandle,
} from './e2b'
import type { SandboxCreateRequest } from './contracts'

/** An E2B stand-in: sandboxes in memory, with a real shell behind `commands.run` so behavior is not guessed. */
function fakeE2b() {
  type Box = { state: 'running' | 'paused' | 'killed'; files: Map<string, Uint8Array>; envs: Record<string, string>; startedAt: Date }
  const sandboxes = new Map<string, Box>()
  const snapshots = new Map<string, Box>()
  const calls: Array<{ method: string; args: unknown[] }> = []
  let counter = 0

  const handleFor = (id: string): E2BSandboxHandle => {
    const record = sandboxes.get(id)!
    return {
      sandboxId: id,
      trafficAccessToken: 'traffic-token',
      commands: {
        run: (async (command: string, options: { background?: boolean; cwd?: string; envs?: Record<string, string>; onStdout?: (data: string) => void; onStderr?: (data: string) => void } = {}) => {
          if (command.startsWith('chmod ')) return { exitCode: 0, stdout: '', stderr: '' }
          const child = spawn('/bin/bash', ['-c', command], { cwd: options.cwd && options.cwd.startsWith('/home') ? undefined : options.cwd, env: { ...process.env, ...record.envs, ...(options.envs ?? {}) } })
          let stdout = ''
          let stderr = ''
          child.stdout.on('data', (chunk) => { stdout += String(chunk); options.onStdout?.(String(chunk)) })
          child.stderr.on('data', (chunk) => { stderr += String(chunk); options.onStderr?.(String(chunk)) })
          const done = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
            child.on('close', (code, signal) => {
              const exitCode = signal ? 143 : (code ?? 0)
              // The real SDK throws on a non-zero exit; a killed process looks the same.
              if (exitCode === 0) resolve({ exitCode, stdout, stderr })
              else reject(Object.assign(new Error('exit'), { exitCode, stdout, stderr }))
            })
          })
          if (options.background) {
            const handle: E2BCommandHandle = { pid: child.pid ?? 0, wait: () => done, kill: async () => child.kill('SIGKILL') }
            return handle
          }
          return await done
        }) as E2BSandboxHandle['commands']['run'],
      },
      files: {
        write: async (path, data) => { record.files.set(path, new Uint8Array(data)) },
        read: async (path) => {
          const found = record.files.get(path)
          if (!found) throw Object.assign(new Error('file not found'), { name: 'FileNotFoundError' })
          return found
        },
        list: async (dir) => [...record.files.entries()].filter(([path]) => path.startsWith(`${dir}/`)).map(([path, data]) => ({ name: path.split('/').pop()!, path, type: 'file', size: data.length })),
      },
      getHost: (port) => `${port}-${id}.e2b.test`,
      createSnapshot: async (options) => {
        const snapshotId = `snap-${options?.name ?? ++counter}`
        snapshots.set(snapshotId, { ...record, files: new Map(record.files) })
        return { snapshotId }
      },
    }
  }

  const sdk: E2BSandboxClass = {
    create: async (template, options) => {
      calls.push({ method: 'create', args: [template, options] })
      const base = snapshots.get(template)
      const id = `sbx-${++counter}`
      sandboxes.set(id, { state: 'running', files: new Map(base?.files ?? []), envs: (options.envs as Record<string, string>) ?? {}, startedAt: new Date() })
      return handleFor(id)
    },
    connect: async (id) => {
      calls.push({ method: 'connect', args: [id] })
      const record = sandboxes.get(id)
      if (!record || record.state === 'killed') throw Object.assign(new Error('sandbox not found'), { name: 'SandboxNotFoundError' })
      record.state = 'running'
      return handleFor(id)
    },
    getInfo: async (id) => {
      const record = sandboxes.get(id)
      if (!record || record.state === 'killed') throw Object.assign(new Error('sandbox not found'), { name: 'SandboxNotFoundError' })
      return { state: record.state as 'running' | 'paused', startedAt: record.startedAt, cpuCount: 2, memoryMB: 4096 }
    },
    pause: async (id) => { calls.push({ method: 'pause', args: [id] }); sandboxes.get(id)!.state = 'paused'; return true },
    kill: async (id) => { calls.push({ method: 'kill', args: [id] }); const record = sandboxes.get(id); if (record) record.state = 'killed'; return Boolean(record) },
    deleteSnapshot: async (id) => snapshots.delete(id),
  }
  return { sdk, sandboxes, calls }
}

const request = (name: string, overrides: Partial<SandboxCreateRequest> = {}): SandboxCreateRequest => ({
  name, image: 'overlay-agent:v4', persistent: true, networkPolicy: { mode: 'allow_all' }, idleTimeoutMs: 0, hardTimeoutMs: 2 * 60 * 60_000, ports: [3000], ...overrides,
})

test('the E2B adapter satisfies the shared sandbox conformance suite', async () => {
  const { sdk } = fakeE2b()
  const result = await runSandboxConformance(new E2BSandboxRuntime({ apiKey: 'k', sandbox: sdk }), request('e2b-conformance'))
  assert.ok(result.checks.includes('provision') && result.checks.includes('files') && result.checks.includes('cancellation') && result.checks.includes('restore'))
})

test('a sandbox is created from the template with a pause-on-timeout lifecycle, the request environment, and no key in metadata', async () => {
  const { sdk, calls } = fakeE2b()
  const runtime = new E2BSandboxRuntime({ apiKey: 'secret-key', sandbox: sdk })
  await runtime.create(request('machine-1', { environment: { A: '1' }, metadata: { agentId: 'a1' } }))
  const [template, options] = calls[0]!.args as [string, { apiKey?: string; envs?: Record<string, string>; metadata?: Record<string, string>; lifecycle?: unknown; timeoutMs?: number }]
  assert.equal(template, 'overlay-agent:v4')
  assert.equal(options.apiKey, 'secret-key')
  assert.deepEqual(options.envs, { A: '1' })
  assert.deepEqual(options.lifecycle, { onTimeout: 'pause', autoResume: false })
  assert.equal(options.timeoutMs, 2 * 60 * 60_000)
  assert.equal(options.metadata?.agentId, 'a1')
  assert.ok(!JSON.stringify(options.metadata).includes('secret-key'))
  await assert.rejects(runtime.create(request('no-image', { image: undefined })), /template/i)
  await runtime.create(request('limit', { hardTimeoutMs: 999 * 60 * 60_000 }))
  assert.equal((calls.at(-1)!.args[1] as Record<string, unknown>).timeoutMs, 24 * 60 * 60_000, 'a timeout above E2B\'s limit is clamped')
})

test('stop pauses, resume connects, delete kills, and a missing sandbox reads as deleted', async () => {
  const { sdk, sandboxes } = fakeE2b()
  const runtime = new E2BSandboxRuntime({ apiKey: 'k', sandbox: sdk })
  const machine = await runtime.create(request('machine'))
  assert.equal(await machine.status(), 'running')
  await machine.stop()
  assert.equal(await machine.status(), 'stopped')
  assert.equal(sandboxes.get(machine.reference)!.state, 'paused')
  await machine.resume()
  assert.equal(await machine.status(), 'running')
  await machine.delete()
  assert.equal(await machine.status(), 'deleted')
  await machine.delete() // idempotent
})

test('reconnecting without resume reads a paused machine without waking it', async () => {
  const { sdk, calls } = fakeE2b()
  const runtime = new E2BSandboxRuntime({ apiKey: 'k', sandbox: sdk })
  const machine = await runtime.create(request('machine'))
  await machine.stop()
  const connectsBefore = calls.filter((call) => call.method === 'connect').length
  const peek = await runtime.reconnect(machine.reference, { resume: false })
  assert.equal(await peek.status(), 'stopped')
  assert.equal(calls.filter((call) => call.method === 'connect').length, connectsBefore, 'a read must not restart billable runtime')
  const woken = await runtime.reconnect(machine.reference)
  assert.equal(await woken.status(), 'running')
})

test('commands report a non-zero exit as a result, stream output, and take a per-command environment', async () => {
  const { sdk } = fakeE2b()
  const machine = await new E2BSandboxRuntime({ apiKey: 'k', sandbox: sdk }).create(request('machine', { environment: { BASE: 'base' } }))
  const failing = await machine.runCommand({ command: '/bin/sh', args: ['-c', 'echo out; echo err >&2; exit 3'], timeoutMs: 10_000 })
  const events: string[] = []
  const reading = (async () => { for await (const event of failing.events()) events.push(`${event.stream}:${event.data.trim()}`) })()
  const result = await failing.wait()
  await reading
  assert.equal(result.exitCode, 3)
  assert.deepEqual(events.sort(), ['stderr:err', 'stdout:out'])
  const env = await machine.runCommand({ command: '/bin/sh', args: ['-c', 'printf "$BASE-$EXTRA"'], environment: { EXTRA: 'x' }, timeoutMs: 10_000 })
  assert.equal((await env.wait()).stdout, 'base-x')
  await machine.updateEnvironment({ BASE: 'changed' }, [])
  assert.equal((await (await machine.runCommand({ command: '/bin/sh', args: ['-c', 'printf "$BASE"'], timeoutMs: 10_000 })).wait()).stdout, 'changed')
  await machine.updateEnvironment({}, ['BASE'])
  assert.equal((await (await machine.runCommand({ command: '/bin/sh', args: ['-c', 'printf "[$BASE]"'], timeoutMs: 10_000 })).wait()).stdout, '[]')
})

test('files round trip, a missing file is null, a mode is applied, and a port carries its access token', async () => {
  const { sdk } = fakeE2b()
  const machine = await new E2BSandboxRuntime({ apiKey: 'k', sandbox: sdk }).create(request('machine'))
  await machine.writeFiles([{ path: '/home/user/a.txt', contents: Buffer.from('hello'), mode: 0o600 }])
  assert.equal(Buffer.from((await machine.readFile('/home/user/a.txt'))!).toString(), 'hello')
  assert.equal(await machine.readFile('/home/user/missing'), null)
  assert.deepEqual((await machine.listFiles('/home/user')).map((entry) => entry.path), ['/home/user/a.txt'])
  const port = await machine.port(3000)
  assert.match(port.url, /^https:\/\/3000-sbx-\d+\.e2b\.test$/)
  assert.deepEqual(port.headers, { 'e2b-traffic-access-token': 'traffic-token' })
  await assert.rejects(machine.updateNetworkPolicy({ mode: 'deny_all' }), /not support/)
})

test('usage counts only the current run, and a paused sandbox costs nothing', async () => {
  const { sdk, sandboxes } = fakeE2b()
  const machine = await new E2BSandboxRuntime({ apiKey: 'k', sandbox: sdk }).create(request('machine'))
  sandboxes.get(machine.reference)!.startedAt = new Date(Date.now() - 60_000)
  const running = await machine.usage()
  assert.ok((running.wallTimeMs ?? 0) >= 59_000)
  assert.equal(running.providerMetrics?.vcpus, 2)
  await machine.stop()
  assert.equal((await machine.usage()).wallTimeMs, 0)
})
