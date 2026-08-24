import { randomUUID } from 'node:crypto'
import { posix as path } from 'node:path'
import { Daytona, type DaytonaConfig, type Sandbox } from '@daytona/sdk'
import { AsyncQueue } from './async-queue'
import type {
  SandboxCapabilities,
  SandboxCommandEvent,
  SandboxCommandHandle,
  SandboxCommandRequest,
  SandboxCommandResult,
  SandboxCreateRequest,
  SandboxFileEntry,
  SandboxInstance,
  SandboxLifecycleState,
  SandboxNetworkPolicy,
  SandboxPort,
  SandboxRuntime,
  SandboxSnapshot,
  SandboxUsage,
} from './contracts'

const CAPABILITIES: SandboxCapabilities = {
  commandStreaming: true,
  files: true,
  environmentVariables: true,
  ports: true,
  snapshots: false,
  persistence: true,
  networkPolicy: true,
  networkPolicyUpdates: false,
  credentialBrokering: true,
  hardTimeout: true,
  idleStop: true,
  usage: true,
}

export type DaytonaSandboxRuntimeOptions = {
  config?: DaytonaConfig
  client?: Daytona
}

export class DaytonaSandboxRuntime implements SandboxRuntime {
  readonly provider = 'daytona' as const
  readonly capabilities = CAPABILITIES
  private readonly client: Daytona

  constructor(options: DaytonaSandboxRuntimeOptions = {}) {
    this.client = options.client ?? new Daytona(options.config)
  }

  async create(request: SandboxCreateRequest): Promise<SandboxInstance> {
    const policy = daytonaNetworkPolicy(request.networkPolicy)
    const secrets = Object.fromEntries((request.credentials ?? []).map((binding) => [binding.environmentVariable, binding.brokerRef]))
    const base = {
      name: request.name,
      envVars: request.environment,
      labels: request.metadata,
      ephemeral: !request.persistent,
      autoStopInterval: Math.max(0, Math.ceil(request.idleTimeoutMs / 60_000)),
      autoDeleteInterval: request.persistent ? -1 : 0,
      ttlMinutes: Math.max(1, Math.ceil(request.hardTimeoutMs / 60_000)),
      ...policy,
      ...(Object.keys(secrets).length ? { secrets } : {}),
    }
    const sandbox = request.image
      ? await this.client.create({ ...base, image: request.image, resources: daytonaResources(request) }, { timeout: 90 })
      : await this.client.create({ ...base, snapshot: request.snapshotId }, { timeout: 90 })
    return new DaytonaSandboxInstance(sandbox)
  }

  async reconnect(reference: string): Promise<SandboxInstance> {
    const sandbox = await this.client.get(reference)
    if (sandbox.state !== 'started') await sandbox.start(90)
    await sandbox.refreshData()
    return new DaytonaSandboxInstance(sandbox)
  }

  restore(snapshotId: string, request: Omit<SandboxCreateRequest, 'snapshotId'>) {
    return this.create({ ...request, snapshotId })
  }

  async deleteSnapshot(snapshotId: string) {
    const snapshot = await this.client.snapshot.get(snapshotId)
    await this.client.snapshot.delete(snapshot)
  }
}

class DaytonaSandboxInstance implements SandboxInstance {
  readonly provider = 'daytona' as const
  readonly capabilities = CAPABILITIES
  get reference() { return this.sandbox.id }
  get name() { return this.sandbox.name }
  private deleted = false

  constructor(private readonly sandbox: Sandbox) {}

  async status(): Promise<SandboxLifecycleState> {
    if (this.deleted) return 'deleted'
    await this.sandbox.refreshData()
    switch (this.sandbox.state) {
      case 'started': return 'running'
      case 'stopped':
      case 'paused': return 'stopped'
      case 'archived': return 'archived'
      case 'destroyed': return 'deleted'
      case 'error':
      case 'build_failed': return 'failed'
      default: return 'provisioning'
    }
  }
  async workingDirectory() { return (await this.sandbox.getWorkDir()) ?? `/home/${this.sandbox.user}` }
  async resume() {
    if (this.sandbox.recoverable) await this.sandbox.recover(90)
    else if (this.sandbox.state !== 'started') await this.sandbox.start(90)
  }
  async stop() { await this.sandbox.stop(90) }
  async delete() { await this.sandbox.delete(90, true); this.deleted = true }

  async runCommand(request: SandboxCommandRequest): Promise<SandboxCommandHandle> {
    const sessionId = `overlay-${randomUUID()}`
    await this.sandbox.process.createSession(sessionId)
    const startedAt = Date.now()
    const queue = new AsyncQueue<SandboxCommandEvent>()
    let commandId = sessionId
    let stdout = ''
    let stderr = ''
    let sequence = 0
    let cancelled = false
    const command = shellCommand(request)
    const started = await this.sandbox.process.executeSessionCommand(sessionId, {
      command,
      runAsync: true,
      suppressInputEcho: true,
    }, Math.max(1, Math.ceil(request.timeoutMs / 1_000)))
    commandId = started.cmdId ?? sessionId
    let result: Promise<SandboxCommandResult> | undefined
    const observe = () => result ??= (async (): Promise<SandboxCommandResult> => {
      const cancelSession = async () => {
        cancelled = true
        await this.sandbox.process.deleteSession(sessionId).catch(() => undefined)
      }
      const abort = () => { void cancelSession() }
      request.signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(abort, request.timeoutMs)
      try {
        if (cancelled) {
          await this.sandbox.process.deleteSession(sessionId).catch(() => undefined)
          return cancelledResult(commandId, startedAt, stdout, stderr)
        }
        await this.sandbox.process.getSessionCommandLogs(
          sessionId,
          commandId,
          (data) => {
            stdout += data
            queue.push({ sequence: ++sequence, stream: 'stdout', data, occurredAt: Date.now() })
          },
          (data) => {
            stderr += data
            queue.push({ sequence: ++sequence, stream: 'stderr', data, occurredAt: Date.now() })
          },
        )
        const finished = await this.sandbox.process.getSessionCommand(sessionId, commandId)
        return {
          commandId,
          exitCode: cancelled ? 130 : finished.exitCode ?? 1,
          stdout,
          stderr,
          startedAt,
          endedAt: Date.now(),
        }
      } catch (error) {
        if (cancelled) return cancelledResult(commandId, startedAt, stdout, stderr)
        throw error
      } finally {
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', abort)
        await this.sandbox.process.deleteSession(sessionId).catch(() => undefined)
        queue.close()
      }
    })()
    return {
      get id() { return commandId },
      events: () => { void observe(); return queue },
      wait: observe,
      cancel: async () => {
        cancelled = true
        await this.sandbox.process.deleteSession(sessionId).catch(() => undefined)
      },
    }
  }

  async writeFiles(files: Array<{ path: string; contents: Uint8Array; mode?: number }>) {
    await this.sandbox.fs.uploadFiles(files.map((file) => ({ source: Buffer.from(file.contents), destination: file.path })))
    for (const file of files) {
      if (file.mode !== undefined) await this.sandbox.fs.setFilePermissions(file.path, { mode: file.mode.toString(8) })
    }
  }
  async readFile(filePath: string) { return await this.sandbox.fs.downloadFile(filePath) }
  async listFiles(directory: string): Promise<SandboxFileEntry[]> {
    return (await this.sandbox.fs.listFiles(directory)).map((entry) => ({
      path: entry.path ?? path.join(directory, entry.name),
      kind: entry.isDir ? 'directory' : 'file',
      size: entry.size,
    }))
  }
  async updateEnvironment(environment: Record<string, string>, unset: string[] = []) {
    await this.sandbox.updateEnv(environment, { unset })
  }
  async updateNetworkPolicy(policy: SandboxNetworkPolicy) {
    await this.sandbox.updateNetworkSettings(daytonaNetworkPolicy(policy))
  }
  async port(port: number): Promise<SandboxPort> {
    const preview = await this.sandbox.getPreviewLink(port)
    return { port, url: preview.url, access: preview.token ? 'private' : 'public' }
  }
  async snapshot(options?: { expiresInMs?: number }): Promise<SandboxSnapshot> {
    void options
    throw new Error('Daytona snapshot creation is experimental and is not advertised by this adapter; use persistent stop and reconnect')
  }
  async usage(): Promise<SandboxUsage> {
    const metrics = await this.sandbox.getMetricsLatest()
    return {
      cpuPercent: metrics.cpuUsedPct,
      memoryBytes: metrics.memUsed,
      providerMetrics: {
        cpuCount: metrics.cpuCount,
        diskTotal: metrics.diskTotal,
        diskUsed: metrics.diskUsed,
        memTotal: metrics.memTotal,
        memCache: metrics.memCache,
      },
    }
  }
  rawProviderDiagnosticHandle() { return this.sandbox }
}

/** Compatibility bridge while legacy Daytona workspace records remain provider-specific. */
export function wrapDaytonaSandbox(sandbox: Sandbox): SandboxInstance {
  return new DaytonaSandboxInstance(sandbox)
}

function daytonaResources(request: SandboxCreateRequest) {
  return {
    cpu: request.resources?.vcpus,
    memory: request.resources?.memoryGiB,
    disk: request.resources?.diskGiB,
  }
}

function daytonaNetworkPolicy(policy: SandboxNetworkPolicy) {
  if (policy.mode === 'allow_all') return { networkBlockAll: false }
  if (policy.mode === 'deny_all') return { networkBlockAll: true }
  return {
    networkBlockAll: false,
    domainAllowList: policy.domains?.join(','),
    networkAllowList: policy.allowedCidrs?.join(','),
  }
}

function shellCommand(request: SandboxCommandRequest) {
  const environment = Object.entries(request.environment ?? {})
    .map(([key, value]) => `${shellQuote(key)}=${shellQuote(value)}`)
    .join(' ')
  const command = [request.command, ...(request.args ?? [])].map(shellQuote).join(' ')
  const executable = environment ? `env ${environment} ${command}` : command
  return request.cwd ? `cd ${shellQuote(request.cwd)} && ${executable}` : executable
}

function shellQuote(value: string) { return `'${value.replace(/'/g, `'\\''`)}'` }

function cancelledResult(commandId: string, startedAt: number, stdout: string, stderr: string): SandboxCommandResult {
  return { commandId, exitCode: 130, stdout, stderr, startedAt, endedAt: Date.now() }
}
