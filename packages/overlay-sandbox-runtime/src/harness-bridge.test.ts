import test from 'node:test'
import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { AsyncQueue } from './async-queue'
import type {
  SandboxCapabilities,
  SandboxCommandEvent,
  SandboxCommandHandle,
  SandboxCommandRequest,
  SandboxCreateRequest,
  SandboxInstance,
  SandboxNetworkPolicy,
  SandboxRuntime,
} from './contracts'
import {
  createOverlayHarnessInstanceProvider,
  createOverlayHarnessSandboxProvider,
  overlayHarnessSandboxSession,
} from './harness-bridge'

/**
 * Bridge coverage is deterministic — a scripted `SandboxInstance` stands in
 * for Daytona/Box so the `HarnessV1NetworkSandboxSession` mapping (commands,
 * files, ports, policy, lifecycle) is asserted without a live provider.
 * Live provider runs stay behind `OVERLAY_SANDBOX_LIVE_CONFORMANCE` in
 * `live-conformance.test.ts`.
 */

const CAPABILITIES: SandboxCapabilities = {
  commandStreaming: true, files: true, environmentVariables: true, ports: true,
  snapshots: false, persistence: true, networkPolicy: true, credentialBrokering: false,
  networkPolicyUpdates: true, hardTimeout: true, idleStop: true, usage: true, desktop: false,
}

function commandHandle(request: {
  events: Array<{ stream: 'stdout' | 'stderr'; data: string }>
  exitCode?: number
  onCancel?: () => void
}): SandboxCommandHandle {
  const queue = new AsyncQueue<SandboxCommandEvent>()
  const startedAt = Date.now()
  let sequence = 0
  const finished = new Promise<{ commandId: string; exitCode: number; stdout: string; stderr: string; startedAt: number; endedAt: number }>((resolve) => {
    setTimeout(() => {
      let stdout = ''
      let stderr = ''
      for (const event of request.events) {
        sequence += 1
        queue.push({ sequence, stream: event.stream, data: event.data, occurredAt: Date.now() })
        if (event.stream === 'stdout') stdout += event.data
        else stderr += event.data
      }
      queue.close()
      resolve({
        commandId: randomUUID(), exitCode: request.exitCode ?? 0, stdout, stderr,
        startedAt, endedAt: Date.now(),
      })
    }, 0)
  })
  return {
    id: randomUUID(),
    events: () => queue,
    wait: () => finished,
    cancel: async () => { request.onCancel?.() },
  }
}

class FakeSandboxInstance implements SandboxInstance {
  readonly provider = 'daytona' as const
  readonly reference: string
  readonly name: string
  capabilities = { ...CAPABILITIES }
  commands: SandboxCommandRequest[] = []
  files = new Map<string, Uint8Array>()
  policies: SandboxNetworkPolicy[] = []
  stopped = false
  deleted = false
  cancelled = 0
  constructor(name: string, private readonly portHeaders?: Record<string, string>) {
    this.name = name
    this.reference = `ref-${name}`
  }
  async status() { return this.deleted ? 'deleted' as const : this.stopped ? 'stopped' as const : 'running' as const }
  async workingDirectory() { return '/home/daytona' }
  async resume() { this.stopped = false }
  async stop() { this.stopped = true }
  async delete() { this.deleted = true }
  async runCommand(request: SandboxCommandRequest): Promise<SandboxCommandHandle> {
    this.commands.push(request)
    const script = request.args?.at(-1) ?? ''
    const events: Array<{ stream: 'stdout' | 'stderr'; data: string }> = []
    let exitCode = 0
    if (script === 'fail') {
      events.push({ stream: 'stderr', data: 'boom' })
      exitCode = 3
    } else if (script.startsWith('echo-err ')) {
      events.push({ stream: 'stderr', data: script.slice('echo-err '.length) })
    } else {
      events.push({ stream: 'stdout', data: `out:${script}` })
    }
    return commandHandle({ events, exitCode, onCancel: () => { this.cancelled += 1 } })
  }
  async writeFiles(files: Array<{ path: string; contents: Uint8Array }>) {
    for (const file of files) this.files.set(file.path, file.contents)
  }
  async readFile(path: string) { return this.files.get(path) ?? null }
  async listFiles() { return [...this.files.keys()].map((path) => ({ path, kind: 'file' as const })) }
  async updateEnvironment() {}
  async updateNetworkPolicy(policy: SandboxNetworkPolicy) { this.policies.push(policy) }
  async port(port: number) {
    return {
      port,
      url: `https://${this.name}-${port}.preview.daytona.test`,
      access: 'private' as const,
      ...(this.portHeaders ? { headers: this.portHeaders } : {}),
    }
  }
  async snapshot() { return { id: randomUUID(), createdAt: Date.now() } }
  async usage() { return { wallTimeMs: 1 } }
  rawProviderDiagnosticHandle() { return this }
}

test('bridge session maps identity, working directory, and description', async () => {
  const instance = new FakeSandboxInstance('sbx-one')
  const session = await overlayHarnessSandboxSession(instance, { ports: [8080] })
  assert.equal(session.id, instance.reference)
  assert.equal(session.defaultWorkingDirectory, '/home/daytona')
  assert.deepEqual([...session.ports], [8080])
  assert.match(session.description, /daytona/)
  assert.match(session.description, /\/home\/daytona/)
  assert.match(session.description, /8080/)
})

test('bridge run executes through sh -lc and collects both streams', async () => {
  const instance = new FakeSandboxInstance('sbx-run')
  const session = await overlayHarnessSandboxSession(instance)
  const result = await session.run({
    command: 'echo hello',
    workingDirectory: '/work',
    env: { FOO: 'bar' },
  })
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, 'out:echo hello')
  assert.equal(result.stderr, '')
  const request = instance.commands[0]!
  assert.equal(request.command, 'sh')
  assert.deepEqual(request.args, ['-lc', 'echo hello'])
  assert.equal(request.cwd, '/work')
  assert.deepEqual(request.environment, { FOO: 'bar' })
})

test('bridge run surfaces non-zero exits and stderr', async () => {
  const instance = new FakeSandboxInstance('sbx-fail')
  const session = await overlayHarnessSandboxSession(instance)
  const result = await session.run({ command: 'fail' })
  assert.equal(result.exitCode, 3)
  assert.equal(result.stderr, 'boom')
})

test('bridge spawn streams stdout and stderr separately and kill cancels', async () => {
  const instance = new FakeSandboxInstance('sbx-spawn')
  const session = await overlayHarnessSandboxSession(instance)
  const process = await session.spawn({ command: 'echo-err warn' })
  assert.equal(await new Response(process.stderr).text(), 'warn')
  assert.equal((await process.wait()).exitCode, 0)
  await process.kill()
  assert.equal(instance.cancelled, 1)
})

test('bridge file APIs round-trip text, bytes, and streams', async () => {
  const instance = new FakeSandboxInstance('sbx-files')
  const session = await overlayHarnessSandboxSession(instance)
  await session.writeTextFile({ path: '/work/a.txt', content: 'line1\nline2\nline3' })
  assert.equal(await session.readTextFile({ path: '/work/a.txt' }), 'line1\nline2\nline3')
  assert.equal(await session.readTextFile({ path: '/work/a.txt', startLine: 2 }), 'line2\nline3')
  assert.equal(await session.readTextFile({ path: '/work/a.txt', startLine: 1, endLine: 2 }), 'line1\nline2')
  assert.equal(await session.readTextFile({ path: '/work/missing.txt' }), null)
  await session.writeBinaryFile({ path: '/work/b.bin', content: new Uint8Array([1, 2, 3]) })
  assert.deepEqual([...(await session.readBinaryFile({ path: '/work/b.bin' }))!], [1, 2, 3])
  await session.writeFile({
    path: '/work/c.txt',
    content: new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode('streamed'))
        controller.close()
      },
    }),
  })
  const streamed = await session.readFile({ path: '/work/c.txt' })
  assert.equal(await new Response(streamed).text(), 'streamed')
})

test('bridge port endpoints carry provider headers and swap protocols', async () => {
  const instance = new FakeSandboxInstance('sbx-ports', { 'x-daytona-preview-token': 'secret-token' })
  const session = await overlayHarnessSandboxSession(instance, { ports: [8080] })
  const endpoint = await session.getPortEndpoint({ port: 8080 })
  assert.equal(endpoint.url, 'https://sbx-ports-8080.preview.daytona.test')
  assert.deepEqual(endpoint.headers, { 'x-daytona-preview-token': 'secret-token' })
  const ws = await session.getPortEndpoint({ port: 8080, protocol: 'ws' })
  assert.equal(ws.url, 'wss://sbx-ports-8080.preview.daytona.test')
  assert.deepEqual(ws.headers, { 'x-daytona-preview-token': 'secret-token' })
  assert.equal(await session.getPortUrl({ port: 8080 }), 'https://sbx-ports-8080.preview.daytona.test')
})

test('bridge setNetworkPolicy maps the harness policy onto the sandbox', async () => {
  const instance = new FakeSandboxInstance('sbx-policy')
  const session = await overlayHarnessSandboxSession(instance)
  await session.setNetworkPolicy?.({
    mode: 'custom',
    allowedHosts: ['example.com'],
    allowedCIDRs: ['10.0.0.0/8'],
    deniedCIDRs: ['169.254.0.0/16'],
  })
  assert.deepEqual(instance.policies[0], {
    mode: 'allowlist',
    domains: ['example.com'],
    allowedCidrs: ['10.0.0.0/8'],
    deniedCidrs: ['169.254.0.0/16'],
  })
  await session.setNetworkPolicy?.({ mode: 'deny-all' })
  assert.deepEqual(instance.policies[1], { mode: 'deny_all' })
})

test('bridge omits setNetworkPolicy when the provider cannot update it', async () => {
  const instance = new FakeSandboxInstance('sbx-nopolicy')
  instance.capabilities = { ...CAPABILITIES, networkPolicyUpdates: false }
  const session = await overlayHarnessSandboxSession(instance)
  assert.equal(session.setNetworkPolicy, undefined)
})

test('bridge restricted() exposes only the file/exec surface', async () => {
  const instance = new FakeSandboxInstance('sbx-restricted')
  const session = await overlayHarnessSandboxSession(instance, { ports: [8080] })
  const restricted = session.restricted()
  assert.equal(typeof restricted.spawn, 'function')
  assert.equal(typeof restricted.readTextFile, 'function')
  assert.equal((restricted as Record<string, unknown>).stop, undefined)
  assert.equal((restricted as Record<string, unknown>).getPortEndpoint, undefined)
  assert.equal((restricted as Record<string, unknown>).setNetworkPolicy, undefined)
  const result = await restricted.run({ command: 'ok' })
  assert.equal(result.stdout, 'out:ok')
})

test('bridge stop/destroy forward to the instance lifecycle', async () => {
  const instance = new FakeSandboxInstance('sbx-life')
  const session = await overlayHarnessSandboxSession(instance)
  await session.stop()
  assert.equal(instance.stopped, true)
  await session.destroy()
  assert.equal(instance.deleted, true)
})

class FakeRuntime implements SandboxRuntime {
  readonly provider = 'daytona' as const
  readonly capabilities = CAPABILITIES
  instances = new Map<string, FakeSandboxInstance>()
  createdNames: string[] = []
  async create(request: SandboxCreateRequest) {
    const instance = new FakeSandboxInstance(request.name)
    this.instances.set(request.name, instance)
    this.createdNames.push(request.name)
    return instance
  }
  async reconnect(reference: string) {
    const instance = this.instances.get(reference)
    if (!instance) throw new Error(`no sandbox named ${reference}`)
    return instance
  }
  async restore(_snapshotId: string, request: Omit<SandboxCreateRequest, 'snapshotId'>) {
    return this.create(request)
  }
  async deleteSnapshot() {}
}

test('provider createSession names the sandbox deterministically and runs onFirstCreate', async () => {
  const runtime = new FakeRuntime()
  const provider = createOverlayHarnessSandboxProvider({ runtime })
  let setupRan = false
  const session = await provider.createSession({
    sessionId: 'Harness_123',
    onFirstCreate: async (restricted) => {
      setupRan = true
      assert.equal(typeof restricted.spawn, 'function')
      assert.equal((restricted as Record<string, unknown>).destroy, undefined)
    },
  })
  assert.equal(setupRan, true)
  assert.equal(runtime.createdNames[0], 'overlay-daytona-harness-harness-123')
  assert.equal(session.id, `ref-${runtime.createdNames[0]}`)
})

test('provider resumeSession reattaches by the same derived name', async () => {
  const runtime = new FakeRuntime()
  const provider = createOverlayHarnessSandboxProvider({ runtime })
  const created = await provider.createSession({ sessionId: 'session-9' })
  const resumed = await provider.resumeSession?.({ sessionId: 'session-9' })
  assert.equal(resumed?.id, created.id)
})

test('provider createSession without a sessionId names uniquely', async () => {
  const runtime = new FakeRuntime()
  const provider = createOverlayHarnessSandboxProvider({ runtime })
  await provider.createSession()
  await provider.createSession()
  assert.notEqual(runtime.createdNames[0], runtime.createdNames[1])
})

test('instance provider wraps the caller-owned sandbox and skips onFirstCreate', async () => {
  const instance = new FakeSandboxInstance('sbx-owned')
  const provider = createOverlayHarnessInstanceProvider({ instance, ports: [3000] })
  assert.equal(provider.providerId, 'overlay-daytona')
  let firstCreateRan = false
  const created = await provider.createSession({
    onFirstCreate: async () => { firstCreateRan = true },
  })
  const resumed = await provider.resumeSession?.({ sessionId: 'anything' })
  assert.equal(created.id, instance.reference)
  assert.equal(resumed?.id, instance.reference)
  assert.equal(firstCreateRan, false)
  assert.deepEqual([...created.ports], [3000])
})
