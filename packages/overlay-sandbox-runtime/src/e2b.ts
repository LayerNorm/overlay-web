import { AsyncQueue } from './async-queue'
import type {
  SandboxCapabilities,
  SandboxCommandEvent,
  SandboxCommandHandle,
  SandboxCommandRequest,
  SandboxCommandResult,
  SandboxCreateRequest,
  SandboxExecutionUsage,
  SandboxFileEntry,
  SandboxInventoryItem,
  SandboxInstance,
  SandboxLifecycleState,
  SandboxNetworkPolicy,
  SandboxPort,
  SandboxRuntime,
  SandboxSnapshot,
  SandboxUsage,
} from './contracts'

/**
 * E2B runtime, for self-hosted Overlay. It uses the official `e2b` SDK and maps it onto Overlay's sandbox port:
 *
 * - A machine is an E2B sandbox. Overlay's "stop" is E2B's **pause** (memory and disk are kept), "resume" is
 *   `Sandbox.connect`, and "delete" is `kill`. The sandbox's own timeout is set to pause rather than kill, so a lost
 *   cleanup cannot destroy a machine's disk.
 * - The image is an E2B template (`name` or `name:tag`), built by `infra/agent-image/build.e2b.ts`. A snapshot is an
 *   E2B snapshot and is used as a template to restore.
 * - E2B templates fix a sandbox's size, so `resources` on a create request is not applied.
 * - Idle stop is Overlay's (like Box): E2B has no idle timer, only a hard timeout.
 *
 * The SDK is injected so the adapter can be tested without E2B.
 */

const CAPABILITIES: SandboxCapabilities = {
  commandStreaming: true,
  files: true,
  environmentVariables: true,
  ports: true,
  snapshots: true,
  persistence: true,
  networkPolicy: false,
  networkPolicyUpdates: false,
  credentialBrokering: false,
  hardTimeout: true,
  idleStop: false,
  usage: true,
  desktop: false,
}

/** Only a successful meter tick extends this fence; pause preserves the machine state. */
const RUNTIME_FENCE_MS = 4 * 60_000

/** The parts of the `e2b` SDK this adapter uses. The real `Sandbox` class satisfies it. */
export type E2BSandboxHandle = {
  readonly sandboxId: string
  readonly trafficAccessToken?: string
  commands: {
    run(command: string, options: { background: true; cwd?: string; envs?: Record<string, string>; timeoutMs?: number; onStdout?: (data: string) => void; onStderr?: (data: string) => void }): Promise<E2BCommandHandle>
    run(command: string, options?: { background?: false; cwd?: string; envs?: Record<string, string>; timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
  files: {
    write(path: string, data: ArrayBuffer): Promise<unknown>
    read(path: string, options: { format: 'bytes' }): Promise<Uint8Array>
    list(path: string): Promise<Array<{ name: string; path: string; type?: string; size: number }>>
  }
  getHost(port: number): string
  createSnapshot(options?: { name?: string }): Promise<{ snapshotId: string }>
  getMetrics?(): Promise<Array<{ cpuUsedPct: number; memUsed: number }>>
}
export type E2BCommandHandle = {
  readonly pid: number
  wait(): Promise<{ exitCode: number; stdout: string; stderr: string }>
  kill(): Promise<boolean>
}
export type E2BSandboxClass = {
  create(template: string, options: Record<string, unknown>): Promise<E2BSandboxHandle>
  list(options: Record<string, unknown>): E2BSandboxPaginator
  connect(sandboxId: string, options?: Record<string, unknown>): Promise<E2BSandboxHandle>
  getInfo(sandboxId: string, options?: Record<string, unknown>): Promise<{ state: 'running' | 'paused'; startedAt: Date; cpuCount?: number; memoryMB?: number }>
  pause(sandboxId: string, options?: Record<string, unknown>): Promise<boolean>
  kill(sandboxId: string, options?: Record<string, unknown>): Promise<boolean>
  setTimeout(sandboxId: string, timeoutMs: number, options?: Record<string, unknown>): Promise<void>
  createSnapshot?(sandboxId: string, options?: { name?: string }): Promise<{ snapshotId: string }>
  deleteSnapshot(snapshotId: string, options?: Record<string, unknown>): Promise<boolean>
}

export type E2BSandboxPaginator = {
  readonly hasNext: boolean
  readonly nextToken?: string
  nextItems(): Promise<Array<{
    sandboxId: string
    state: 'running' | 'paused'
    startedAt: Date
    metadata: Record<string, string>
  }>>
}

export type E2BRuntimeOptions = {
  apiKey: string
  /** Self-hosted E2B control plane, when not the E2B cloud. */
  domain?: string
  /** Template used when a request names no image. */
  defaultTemplate?: string
  sandbox: E2BSandboxClass
  fetch?: typeof fetch
  now?: () => number
}

/** E2B credentials from the environment. */
export function e2bApiKeyFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.E2B_API_KEY?.trim() || undefined
}

export class E2BSandboxRuntime implements SandboxRuntime {
  readonly provider = 'e2b' as const
  readonly capabilities = CAPABILITIES

  constructor(private readonly options: E2BRuntimeOptions) {}

  /** Connection options every SDK call carries. */
  connection(): Record<string, unknown> {
    return { apiKey: this.options.apiKey, ...(this.options.domain ? { domain: this.options.domain } : {}) }
  }

  async create(request: SandboxCreateRequest): Promise<SandboxInstance> {
    const template = request.snapshotId ?? request.image ?? this.options.defaultTemplate
    if (!template) throw new E2BError('No E2B template named: set OVERLAY_CLOUD_AGENT_IMAGE to the template built by infra/agent-image/build.e2b.ts', 'template_missing')
    const handle = await this.options.sandbox.create(template, {
      ...this.connection(),
      timeoutMs: Math.min(Math.max(request.hardTimeoutMs, 60_000), RUNTIME_FENCE_MS),
      envs: request.environment ?? {},
      metadata: { ...(request.metadata ?? {}), overlay: 'true', overlayName: request.name, ...(request.allocationKey ? { overlayAllocationKey: request.allocationKey } : {}) },
      allowInternetAccess: request.networkPolicy.mode !== 'deny_all',
      // A sandbox that reaches its timeout is paused, not destroyed: its disk is a machine's whole state.
      lifecycle: { onTimeout: 'pause', autoResume: false },
    })
    await request.onAllocated?.(handle.sandboxId)
    return new E2BSandbox(this, handle.sandboxId, request.name, handle, request.environment ?? {})
  }

  async listInventory(args: { cursor?: string; limit: number }): Promise<{
    items: SandboxInventoryItem[]
    nextCursor?: string
  }> {
    const paginator = this.options.sandbox.list({
      ...this.connection(),
      query: { metadata: { overlay: 'true' }, state: ['running', 'paused'] },
      limit: args.limit,
      ...(args.cursor ? { nextToken: args.cursor } : {}),
    })
    const sandboxes = await paginator.nextItems()
    const items = sandboxes.map((sandbox): SandboxInventoryItem => ({
      reference: sandbox.sandboxId,
      state: sandbox.state,
      ...(Number.isFinite(sandbox.startedAt.getTime()) ? { createdAt: sandbox.startedAt.getTime() } : {}),
      ...(sandbox.metadata.overlayAllocationKey
        ? { allocationKey: sandbox.metadata.overlayAllocationKey }
        : {}),
    }))
    return {
      items,
      ...(paginator.hasNext && paginator.nextToken ? { nextCursor: paginator.nextToken } : {}),
    }
  }

  async reconnect(reference: string, options: { resume?: boolean } = {}): Promise<SandboxInstance> {
    const instance = new E2BSandbox(this, reference, reference, null, {})
    if (options.resume !== false && await instance.status() === 'stopped') await instance.resume()
    return instance
  }

  async restore(snapshotId: string, request: Omit<SandboxCreateRequest, 'snapshotId'>): Promise<SandboxInstance> {
    return await this.create({ ...request, snapshotId })
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    await this.options.sandbox.deleteSnapshot(snapshotId, this.connection())
  }

  get sdk(): E2BSandboxClass {
    return this.options.sandbox
  }

  now(): number {
    return (this.options.now ?? Date.now)()
  }

  async executionUsage(reference: string): Promise<{ samples: SandboxExecutionUsage[]; killed: boolean }> {
    const samples: SandboxExecutionUsage[] = []
    let killed = false
    const deadline = this.now() + 30_000
    for (let offset = 0; offset < 2_000; offset += 100) {
      const remainingMs = deadline - this.now()
      if (remainingMs <= 0) throw new E2BError('Execution event read deadline exceeded', 'usage_incomplete')
      const url = new URL(`/events/sandboxes/${encodeURIComponent(reference)}`, `https://api.${this.options.domain ?? 'e2b.app'}`)
      url.searchParams.set('offset', String(offset))
      url.searchParams.set('limit', '100')
      url.searchParams.set('orderAsc', 'false')
      url.searchParams.append('types', 'sandbox.lifecycle.paused')
      url.searchParams.append('types', 'sandbox.lifecycle.killed')
      const response = await (this.options.fetch ?? fetch)(url, {
        headers: { 'X-API-Key': this.options.apiKey },
        signal: AbortSignal.timeout(Math.min(15_000, remainingMs)),
        redirect: 'error',
      })
      if (!response.ok) throw new E2BError(`Execution usage unavailable (${response.status})`, 'usage_unavailable')
      const events: unknown = await response.json()
      if (!Array.isArray(events)) throw new E2BError('Invalid execution event response', 'usage_invalid')
      for (const value of events) {
        const event = value as E2BExecutionEvent
        if (event.sandboxId !== reference || !['sandbox.lifecycle.paused', 'sandbox.lifecycle.killed'].includes(event.type)) {
          throw new E2BError('Execution event does not belong to this sandbox', 'usage_invalid')
        }
        const execution = event.eventData?.execution
        const startedAt = typeof execution?.started_at === 'string' ? Date.parse(execution.started_at) : NaN
        if (!execution || !Number.isFinite(startedAt)
          || !Number.isFinite(execution.execution_time) || execution.execution_time < 0
          || !Number.isFinite(execution.vcpu_count) || execution.vcpu_count <= 0
          || !Number.isFinite(execution.memory_mb) || execution.memory_mb <= 0) {
          throw new E2BError('Execution event has no complete allocation and duration evidence', 'usage_invalid')
        }
        samples.push({
          id: `${reference}:${startedAt}`,
          startedAt,
          wallTimeMs: execution.execution_time,
          complete: true,
          resources: { vcpus: execution.vcpu_count, memoryGiB: execution.memory_mb / 1024 },
        })
        killed ||= event.type === 'sandbox.lifecycle.killed'
      }
      if (events.length < 100) return { samples, killed }
    }
    throw new E2BError('Execution event pagination exceeded the safe read bound', 'usage_incomplete')
  }
}

type E2BExecutionEvent = {
  sandboxId: string
  type: string
  eventData?: { execution?: { started_at: string; execution_time: number; vcpu_count: number; memory_mb: number } }
}

export class E2BError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'E2BError'
  }
}

class E2BSandbox implements SandboxInstance {
  readonly provider = 'e2b' as const
  readonly capabilities = CAPABILITIES
  private environment: Record<string, string>
  private unset = new Set<string>()

  constructor(
    private readonly runtime: E2BSandboxRuntime,
    readonly reference: string,
    readonly name: string,
    private handle: E2BSandboxHandle | null,
    environment: Record<string, string>,
  ) {
    this.environment = { ...environment }
  }

  /** The live sandbox, connecting (which resumes a paused one) on first use. */
  private async live(): Promise<E2BSandboxHandle> {
    this.handle ??= await this.runtime.sdk.connect(this.reference, { ...this.runtime.connection(), timeoutMs: RUNTIME_FENCE_MS })
    return this.handle
  }

  async status(): Promise<SandboxLifecycleState> {
    try {
      const info = await this.runtime.sdk.getInfo(this.reference, this.runtime.connection())
      return info.state === 'running' ? 'running' : 'stopped'
    } catch (error) {
      if (isNotFound(error)) return 'deleted'
      throw error
    }
  }

  async workingDirectory(): Promise<string> {
    return '/home/user'
  }

  async resume(): Promise<void> {
    this.handle = await this.runtime.sdk.connect(this.reference, { ...this.runtime.connection(), timeoutMs: RUNTIME_FENCE_MS })
  }

  async renewRuntime(timeoutMs: number): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new E2BError('Invalid runtime fence', 'timeout_invalid')
    await this.runtime.sdk.setTimeout(this.reference, Math.min(timeoutMs, RUNTIME_FENCE_MS), { ...this.runtime.connection(), requestTimeoutMs: 15_000 })
  }

  async stop(): Promise<void> {
    await this.runtime.sdk.pause(this.reference, this.runtime.connection())
    this.handle = null
  }

  async delete(): Promise<void> {
    try {
      await this.runtime.sdk.kill(this.reference, this.runtime.connection())
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    this.handle = null
  }

  async runCommand(request: SandboxCommandRequest): Promise<SandboxCommandHandle> {
    const sandbox = await this.live()
    const queue = new AsyncQueue<SandboxCommandEvent>()
    let sequence = 0
    const push = (stream: 'stdout' | 'stderr') => (data: string) => {
      queue.push({ sequence: sequence += 1, stream, data, occurredAt: Date.now() })
    }
    const startedAt = Date.now()
    const environment = { ...this.environment, ...(request.environment ?? {}) }
    // A variable the sandbox was created with cannot be removed from it, so an unset one is blanked for each command.
    for (const key of this.unset) environment[key] = ''
    const handle = await sandbox.commands.run(commandLine(request.command, request.args), {
      background: true,
      ...(request.cwd ? { cwd: request.cwd } : {}),
      envs: environment,
      timeoutMs: request.detached ? 0 : request.timeoutMs,
      onStdout: push('stdout'),
      onStderr: push('stderr'),
    })
    const finished = (async (): Promise<SandboxCommandResult> => {
      try {
        const result = await handle.wait()
        return { commandId: String(handle.pid), exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, startedAt, endedAt: Date.now() }
      } catch (error) {
        // The SDK throws on a non-zero exit; that is a result here, not a failure.
        const failed = error as { exitCode?: number; stdout?: string; stderr?: string; message?: string }
        if (typeof failed.exitCode === 'number') {
          return { commandId: String(handle.pid), exitCode: failed.exitCode, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '', startedAt, endedAt: Date.now() }
        }
        throw error
      } finally {
        queue.close()
      }
    })()
    request.signal?.addEventListener('abort', () => { void handle.kill() }, { once: true })
    return {
      id: String(handle.pid),
      events: () => queue,
      wait: () => finished,
      cancel: async () => { await handle.kill() },
    }
  }

  async writeFiles(files: Array<{ path: string; contents: Uint8Array; mode?: number }>): Promise<void> {
    const sandbox = await this.live()
    for (const file of files) {
      const buffer = file.contents.buffer.slice(file.contents.byteOffset, file.contents.byteOffset + file.contents.byteLength) as ArrayBuffer
      await sandbox.files.write(file.path, buffer)
      if (file.mode) {
        await sandbox.commands.run(`chmod ${(file.mode & 0o777).toString(8)} ${shellQuote(file.path)}`, { timeoutMs: 15_000 })
      }
    }
  }

  async readFile(path: string): Promise<Uint8Array | null> {
    try {
      return await (await this.live()).files.read(path, { format: 'bytes' })
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async listFiles(path: string): Promise<SandboxFileEntry[]> {
    const entries = await (await this.live()).files.list(path)
    return entries.map((entry) => ({
      path: entry.path,
      kind: entry.type === 'dir' || entry.type === 'directory' ? 'directory' : entry.type === 'file' ? 'file' : 'other',
      size: entry.size,
    }))
  }

  async updateEnvironment(environment: Record<string, string>, unset: string[] = []): Promise<void> {
    // E2B applies a sandbox's variables when it starts, so later changes ride on each command instead.
    this.environment = { ...this.environment, ...environment }
    for (const key of unset) { delete this.environment[key]; this.unset.add(key) }
    for (const key of Object.keys(environment)) this.unset.delete(key)
  }

  async updateNetworkPolicy(_policy: SandboxNetworkPolicy): Promise<void> {
    throw new E2BError('E2B does not support changing the network policy of a running sandbox', 'unsupported')
  }

  async port(port: number): Promise<SandboxPort> {
    const sandbox = await this.live()
    return {
      port,
      url: `https://${sandbox.getHost(port)}`,
      access: sandbox.trafficAccessToken ? 'private' : 'public',
      ...(sandbox.trafficAccessToken ? { headers: { 'e2b-traffic-access-token': sandbox.trafficAccessToken } } : {}),
    }
  }

  async snapshot(options: { expiresInMs?: number; name?: string } = {}): Promise<SandboxSnapshot> {
    const sandbox = await this.live()
    const created = await sandbox.createSnapshot(options.name ? { name: options.name } : undefined)
    return { id: created.snapshotId, createdAt: Date.now(), ...(options.expiresInMs ? { expiresAt: Date.now() + options.expiresInMs } : {}) }
  }

  async usage(): Promise<SandboxUsage> {
    const observedAt = this.runtime.now()
    const info = await this.runtime.sdk.getInfo(this.reference, this.runtime.connection()).catch((error) => {
      if (isNotFound(error)) return null
      throw error
    })
    const { samples, killed } = await this.runtime.executionUsage(this.reference)
    if (!info && !killed) throw new E2BError('Waiting for the final execution event', 'usage_incomplete')
    const startedAt = info?.startedAt.getTime()
    const current = samples.find((sample) => sample.startedAt === startedAt)
    const running = info?.state === 'running' && !current
    if (running && info) {
      if (!Number.isFinite(startedAt) || !Number.isFinite(info.cpuCount) || !Number.isFinite(info.memoryMB)
        || (info.cpuCount ?? 0) <= 0 || (info.memoryMB ?? 0) <= 0) {
        throw new E2BError('Actual allocation is unavailable', 'usage_invalid')
      }
      samples.push({
        id: `${this.reference}:${startedAt}`,
        startedAt: startedAt!,
        wallTimeMs: Math.max(0, observedAt - startedAt!),
        complete: false,
        resources: { vcpus: info.cpuCount!, memoryGiB: info.memoryMB! / 1024 },
      })
    } else if (info && !current) {
      throw new E2BError('Waiting for the paused execution event', 'usage_incomplete')
    }
    return {
      executions: samples,
      wallTimeMs: current?.wallTimeMs ?? (running ? Math.max(0, observedAt - startedAt!) : 0),
      providerMetrics: { running, usageSource: 'execution-events-v2', ...(info?.cpuCount ? { vcpus: info.cpuCount } : {}), ...(info?.memoryMB ? { memoryMiB: info.memoryMB } : {}) },
    }
  }

  rawProviderDiagnosticHandle(): unknown {
    return { sandboxId: this.reference }
  }
}

function commandLine(command: string, args: string[] | undefined): string {
  return [command, ...(args ?? []).map(shellQuote)].join(' ')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? ''
  return /NotFound/i.test(name) || /not found|404/i.test((error as { message?: string } | null)?.message ?? '')
}
