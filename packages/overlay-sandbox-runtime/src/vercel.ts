import { posix as path } from 'node:path'
import { Sandbox, Snapshot, type NetworkPolicy } from '@vercel/sandbox'
import { AsyncQueue } from './async-queue'
import type {
  SandboxCapabilities,
  SandboxCommandEvent,
  SandboxCommandHandle,
  SandboxCommandRequest,
  SandboxCommandResult,
  SandboxCreateRequest,
  SandboxCredentialBroker,
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
  snapshots: true,
  persistence: true,
  networkPolicy: true,
  networkPolicyUpdates: true,
  credentialBrokering: true,
  hardTimeout: true,
  idleStop: false,
  usage: true,
}

type VercelCredentials = { token: string; teamId: string; projectId: string }

export type VercelSandboxSdk = {
  create(params: Parameters<typeof Sandbox.create>[0]): ReturnType<typeof Sandbox.create>
  get(params: Parameters<typeof Sandbox.get>[0]): ReturnType<typeof Sandbox.get>
  getSnapshot(params: Parameters<typeof Snapshot.get>[0]): ReturnType<typeof Snapshot.get>
}

export type VercelSandboxRuntimeOptions = {
  credentials?: VercelCredentials
  credentialBroker?: SandboxCredentialBroker
  /** Test/operator injection point; normal callers use the official SDK statics. */
  sdk?: VercelSandboxSdk
}

export class VercelSandboxRuntime implements SandboxRuntime {
  readonly provider = 'vercel' as const
  readonly capabilities = CAPABILITIES
  private readonly sdk: VercelSandboxSdk

  constructor(private readonly options: VercelSandboxRuntimeOptions = {}) {
    this.sdk = options.sdk ?? {
      create: (params) => Sandbox.create(params),
      get: (params) => Sandbox.get(params),
      getSnapshot: (params) => Snapshot.get(params),
    }
  }

  async create(request: SandboxCreateRequest): Promise<SandboxInstance> {
    const networkPolicy = await this.networkPolicy(request)
    const shared = {
      ...this.options.credentials,
      name: request.name,
      persistent: request.persistent,
      timeout: request.hardTimeoutMs,
      ports: request.ports,
      resources: request.resources?.vcpus ? { vcpus: request.resources.vcpus } : undefined,
      networkPolicy,
      env: {
        ...request.environment,
        ...(await this.credentialPlaceholders(request)),
      },
      tags: trimTags(request.metadata),
      keepLastSnapshots: request.persistent ? { count: 3, deleteEvicted: true } : undefined,
    }
    const sandbox = request.snapshotId
      ? await this.sdk.create({ ...shared, source: { type: 'snapshot', snapshotId: request.snapshotId } })
      : await this.sdk.create({ ...shared, ...(request.image ? { image: request.image } : {}) })
    return new VercelSandboxInstance(sandbox, request.environment)
  }

  async reconnect(reference: string): Promise<SandboxInstance> {
    const sandbox = await this.sdk.get({ ...this.options.credentials, name: reference, resume: true })
    return new VercelSandboxInstance(sandbox)
  }

  restore(snapshotId: string, request: Omit<SandboxCreateRequest, 'snapshotId'>) {
    return this.create({ ...request, snapshotId })
  }

  async deleteSnapshot(snapshotId: string) {
    const snapshot = await this.sdk.getSnapshot({ ...this.options.credentials, snapshotId })
    await snapshot.delete()
  }

  private async credentialPlaceholders(request: SandboxCreateRequest) {
    const values: Record<string, string> = {}
    for (const binding of request.credentials ?? []) {
      const material = await requiredBroker(this.options).resolve(binding)
      values[binding.environmentVariable] = material.placeholder ?? `overlay-broker://${binding.brokerRef}`
    }
    return values
  }

  private async networkPolicy(request: SandboxCreateRequest): Promise<NetworkPolicy> {
    const policy = request.networkPolicy
    const credentials = request.credentials ?? []
    if (credentials.length === 0) return vercelNetworkPolicy(policy)

    const allowed = new Map<string, Array<{ transform: Array<{ headers: Record<string, string> }> }>>()
    if (policy.mode === 'allowlist') {
      for (const domain of policy.domains ?? []) allowed.set(domain, [])
    }
    for (const binding of credentials) {
      const material = await requiredBroker(this.options).resolve(binding)
      for (const domain of binding.allowedDomains) {
        const rules = allowed.get(domain) ?? []
        rules.push({ transform: [{ headers: material.headers }] })
        allowed.set(domain, rules)
      }
    }
    return {
      allow: Object.fromEntries(allowed),
      ...(policy.mode === 'allowlist' && (policy.allowedCidrs?.length || policy.deniedCidrs?.length)
        ? { subnets: { allow: policy.allowedCidrs, deny: policy.deniedCidrs } }
        : {}),
    }
  }
}

class VercelSandboxInstance implements SandboxInstance {
  readonly provider = 'vercel' as const
  readonly capabilities = CAPABILITIES
  get reference() { return this.sandbox.name }
  get name() { return this.sandbox.name }
  private deleted = false

  constructor(
    private readonly sandbox: Sandbox,
    environment: Record<string, string> = {},
  ) {
    this.environment = { ...environment }
  }
  private environment: Record<string, string>

  async status(): Promise<SandboxLifecycleState> {
    if (this.deleted) return 'deleted'
    switch (this.sandbox.status) {
      case 'running': return 'running'
      case 'stopped': return 'stopped'
      case 'failed':
      case 'aborted': return 'failed'
      case 'stopping':
      case 'pending':
      case 'snapshotting': return 'provisioning'
      default: return 'provisioning'
    }
  }

  async workingDirectory() { return this.sandbox.cwd }

  async resume() {
    await this.sandbox.runCommand('true', [], { timeoutMs: 10_000 })
  }
  async stop() { await this.sandbox.stop() }
  async delete() { await this.sandbox.delete(); this.deleted = true }

  async runCommand(request: SandboxCommandRequest): Promise<SandboxCommandHandle> {
    const command = await this.sandbox.runCommand({
      cmd: request.command,
      args: request.args,
      cwd: request.cwd,
      env: { ...this.environment, ...request.environment },
      detached: true,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
    })
    const queue = new AsyncQueue<SandboxCommandEvent>()
    const startedAt = Date.now()
    let stdout = ''
    let stderr = ''
    let sequence = 0
    let result: Promise<SandboxCommandResult> | undefined
    const observe = () => result ??= (async (): Promise<SandboxCommandResult> => {
      try {
        for await (const line of command.logs({ signal: request.signal })) {
          if (line.stream === 'stdout') stdout += line.data
          else stderr += line.data
          queue.push({ sequence: ++sequence, stream: line.stream, data: line.data, occurredAt: Date.now() })
        }
        const finished = await command.wait({ signal: request.signal })
        return { commandId: command.cmdId, exitCode: finished.exitCode, stdout, stderr, startedAt, endedAt: Date.now() }
      } finally {
        queue.close()
      }
    })()
    return {
      id: command.cmdId,
      events: () => { void observe(); return queue },
      wait: observe,
      cancel: () => command.kill(),
    }
  }

  async writeFiles(files: Array<{ path: string; contents: Uint8Array; mode?: number }>) {
    await this.sandbox.writeFiles(files.map((file) => ({ path: file.path, content: file.contents, mode: file.mode })))
  }
  async readFile(filePath: string) {
    return await this.sandbox.readFileToBuffer({ path: filePath })
  }
  async listFiles(directory: string): Promise<SandboxFileEntry[]> {
    const entries = await this.sandbox.fs.readdir(directory, { withFileTypes: true })
    return await Promise.all(entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name)
      const stats = await this.sandbox.fs.lstat(filePath)
      return {
        path: filePath,
        kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symlink' : 'other',
        size: stats.size,
      }
    }))
  }
  async updateEnvironment(environment: Record<string, string>, unset: string[] = []) {
    for (const key of unset) delete this.environment[key]
    Object.assign(this.environment, environment)
  }
  async updateNetworkPolicy(policy: SandboxNetworkPolicy) {
    await this.sandbox.update({ networkPolicy: vercelNetworkPolicy(policy) })
  }
  async port(port: number): Promise<SandboxPort> {
    return { port, url: this.sandbox.domain(port), access: 'public' }
  }
  async snapshot(options?: { expiresInMs?: number }): Promise<SandboxSnapshot> {
    const snapshot = await this.sandbox.snapshot({ expiration: options?.expiresInMs })
    return { id: snapshot.snapshotId, createdAt: snapshot.createdAt.getTime(), expiresAt: snapshot.expiresAt?.getTime() }
  }
  async usage(): Promise<SandboxUsage> {
    return {
      wallTimeMs: this.sandbox.totalDurationMs,
      activeCpuTimeMs: this.sandbox.totalActiveCpuDurationMs,
      ingressBytes: this.sandbox.totalIngressBytes,
      egressBytes: this.sandbox.totalEgressBytes,
    }
  }
  rawProviderDiagnosticHandle() { return this.sandbox }
}

function requiredBroker(options: VercelSandboxRuntimeOptions) {
  if (!options.credentialBroker) throw new Error('Sandbox credential bindings require an Overlay credential broker')
  return options.credentialBroker
}

function vercelNetworkPolicy(policy: SandboxNetworkPolicy): NetworkPolicy {
  if (policy.mode === 'allow_all') return 'allow-all'
  if (policy.mode === 'deny_all') return 'deny-all'
  return {
    allow: policy.domains,
    subnets: { allow: policy.allowedCidrs, deny: policy.deniedCidrs },
  }
}

function trimTags(metadata?: Record<string, string>) {
  return metadata ? Object.fromEntries(Object.entries(metadata).slice(0, 5)) : undefined
}
