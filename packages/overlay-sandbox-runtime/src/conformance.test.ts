import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { posix as path } from 'node:path'
import { AsyncQueue } from './async-queue'
import { runSandboxConformance } from './conformance'
import type {
  SandboxCapabilities, SandboxCommandEvent, SandboxCommandHandle, SandboxCreateRequest,
  SandboxInstance, SandboxLifecycleState, SandboxNetworkPolicy, SandboxProviderId, SandboxRuntime,
} from './contracts'

const capabilities: SandboxCapabilities = {
  commandStreaming: true, files: true, environmentVariables: true, ports: true,
  snapshots: true, persistence: true, networkPolicy: true, credentialBrokering: true,
  networkPolicyUpdates: true,
  hardTimeout: true, idleStop: true, usage: true,
}

for (const provider of ['vercel', 'daytona'] as const) {
  test(`reference runtime satisfies the ${provider} capability profile`, async () => {
    const runtime = new MemoryRuntime(provider)
    await runSandboxConformance(runtime, request(`${provider}-conformance`))
  })
}

class MemoryRuntime implements SandboxRuntime {
  readonly capabilities = capabilities
  private instances = new Map<string, MemorySandbox>()
  constructor(readonly provider: SandboxProviderId) {}
  async create(input: SandboxCreateRequest) {
    const sandbox = new MemorySandbox(this.provider, input.name)
    this.instances.set(input.name, sandbox)
    return sandbox
  }
  async reconnect(reference: string) {
    const sandbox = this.instances.get(reference)
    if (!sandbox) throw new Error('missing sandbox')
    await sandbox.resume()
    return sandbox
  }
  restore(_snapshotId: string, input: Omit<SandboxCreateRequest, 'snapshotId'>) { return this.create(input) }
  async deleteSnapshot(snapshotId: string) { void snapshotId }
}

class MemorySandbox implements SandboxInstance {
  readonly capabilities = capabilities
  readonly reference: string
  private state: SandboxLifecycleState = 'running'
  private files = new Map<string, Uint8Array>()
  private environment = new Map<string, string>()
  constructor(readonly provider: SandboxProviderId, readonly name: string) { this.reference = name }
  async status() { return this.state }
  async workingDirectory() { return '/workspace' }
  async resume() { this.state = 'running' }
  async stop() { this.state = 'stopped' }
  async delete() { this.state = 'deleted' }
  async runCommand(request: { command: string; args?: string[] }): Promise<SandboxCommandHandle> {
    const queue = new AsyncQueue<SandboxCommandEvent>()
    const id = randomUUID()
    let cancelled = false
    const startedAt = Date.now()
    const output = request.command === 'printf'
      ? request.args?.join(' ') ?? ''
      : request.command === '/bin/sh' && request.args?.at(-1)?.includes('OVERLAY_CONFORMANCE')
        ? this.environment.get('OVERLAY_CONFORMANCE') ?? ''
        : ''
    const finished = new Promise<ReturnType<SandboxCommandHandle['wait']> extends Promise<infer T> ? T : never>((resolve) => {
      setTimeout(() => {
        if (!cancelled && output) queue.push({ sequence: 1, stream: 'stdout', data: output, occurredAt: Date.now() })
        queue.close()
        resolve({ commandId: id, exitCode: cancelled ? 130 : 0, stdout: cancelled ? '' : output, stderr: '', startedAt, endedAt: Date.now() })
      }, request.command === 'sleep' ? 10 : 0)
    })
    return { id, events: () => queue, wait: () => finished, cancel: async () => { cancelled = true } }
  }
  async writeFiles(files: Array<{ path: string; contents: Uint8Array }>) { for (const file of files) this.files.set(file.path, file.contents) }
  async readFile(filePath: string) { return this.files.get(filePath) ?? null }
  async listFiles(directory: string) { return [...this.files.keys()].filter((entry) => path.dirname(entry) === directory).map((entry) => ({ path: entry, kind: 'file' as const })) }
  async updateEnvironment(environment: Record<string, string>, unset: string[] = []) {
    for (const key of unset) this.environment.delete(key)
    for (const [key, value] of Object.entries(environment)) this.environment.set(key, value)
  }
  async updateNetworkPolicy(policy: SandboxNetworkPolicy) { void policy }
  async port(port: number) { return { port, url: `https://${this.name}-${port}.example.test`, access: 'private' as const } }
  async snapshot() { return { id: randomUUID(), createdAt: Date.now() } }
  async usage() { return { wallTimeMs: 1, activeCpuTimeMs: 1 } }
  rawProviderDiagnosticHandle() { return this }
}

function request(name: string): SandboxCreateRequest {
  return {
    name, persistent: true, idleTimeoutMs: 60_000, hardTimeoutMs: 60_000,
    ports: [3000], networkPolicy: { mode: 'allowlist', domains: ['getoverlay.io'] },
  }
}
