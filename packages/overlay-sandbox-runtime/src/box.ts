import { randomUUID } from 'node:crypto'
import { AsyncQueue } from './async-queue'
import type {
  DesktopSandboxInstance,
  DesktopStreamTicket,
  SandboxCapabilities,
  SandboxCommandEvent,
  SandboxCommandHandle,
  SandboxCommandRequest,
  SandboxCommandResult,
  SandboxCreateRequest,
  SandboxFileEntry,
  SandboxInstance,
  SandboxLifecycleState,
  SandboxPort,
  SandboxResources,
  SandboxRuntime,
  SandboxSnapshot,
  SandboxUsage,
} from './contracts'

/**
 * Box (ascii.dev) runtime: Linux VMs with a real streamed desktop.
 *
 * Mapping notes against the SandboxRuntime port:
 * - `hardTimeoutMs` → `ttlSeconds` (box's auto-archive ceiling). Idle stop is
 *   ours, enforced by `enforceSandboxIdleStop` — box has no idle timer.
 * - `environment` → `env` at create/fork only. `updateEnvironment` is emulated
 *   by prefixing subsequent `runCommand` calls with `env KEY=…`; the values are
 *   not persisted into the box's own environment and never reach snapshots.
 * - Commands always run detached (sync cap is 600s, ours may exceed it) and are
 *   polled through `/commands/{processId}`. `cancel()` kills the OS `pid`
 *   returned at start; `events()` streams appended log output.
 * - Files resolve under `/home/user` or `/tmp` only — the provider's rule, not
 *   ours. `listFiles` is emulated with `find` since the API is read/write only.
 * - Every box is created `noEnv: true` — none of the Overlay box account's
 *   secrets may reach a customer machine. `request.metadata` has no box
 *   equivalent; tag machines through `environment` variables instead.
 */
const CAPABILITIES: SandboxCapabilities = {
  commandStreaming: false,
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
  usage: false,
  desktop: true,
}

const DEFAULT_BASE_URL = 'https://ascii.dev/api/box/v1'
const WORK_DIR = '/home/user'
const POLL_INTERVAL_MS = 750
const PROVISION_TIMEOUT_MS = 5 * 60_000
const STOP_TIMEOUT_MS = 10 * 60_000
const SNAPSHOT_TIMEOUT_MS = 15 * 60_000

export class BoxApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'BoxApiError'
  }
}

type BoxState =
  | 'init' | 'provisioning' | 'provisioned' | 'cloning'
  | 'ready' | 'idle' | 'running'
  | 'archiving' | 'archived' | 'error'

type BoxInfo = {
  id: string
  name?: string
  state: BoxState
  type?: string
  url?: string | null
  snapshotAvailable?: boolean
  desktopAvailable?: boolean
}

export type BoxFetch = (
  input: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json(): Promise<unknown> }>

export type BoxSandboxRuntimeOptions = {
  apiKey?: string
  baseUrl?: string
  fetch?: BoxFetch
}

export class BoxSandboxRuntime implements SandboxRuntime {
  readonly provider = 'box' as const
  readonly capabilities = CAPABILITIES
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetch: BoxFetch

  constructor(options: BoxSandboxRuntimeOptions = {}) {
    const apiKey = options.apiKey ?? process.env.BOX_API_KEY
    if (!apiKey) throw new Error('BOX_API_KEY is not configured')
    this.apiKey = apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetch = options.fetch ?? (async (input, init) => {
      const response = await fetch(input, init)
      return { status: response.status, json: () => response.json() }
    })
  }

  /** Raw v1 call. Response envelopes carry `ok`; errors throw BoxApiError. */
  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    init: { body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const query = init.query ? `?${new URLSearchParams(init.query).toString()}` : ''
    const response = await this.fetch(`${this.baseUrl}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const envelope = (await response.json()) as {
      ok?: boolean
      status?: number
      code?: string
      message?: string
      requestId?: string
      error?: { code?: string; message?: string; status?: number }
    }
    if (!response.status.toString().startsWith('2') || envelope.ok === false) {
      throw new BoxApiError(
        envelope.error?.status ?? envelope.status ?? response.status,
        envelope.error?.code ?? envelope.code ?? 'unknown',
        envelope.error?.message ?? envelope.message ?? `box request failed (${response.status})`,
        envelope.requestId,
      )
    }
    return envelope as T
  }

  async create(request: SandboxCreateRequest): Promise<SandboxInstance> {
    if (request.credentials?.length) {
      throw new BoxApiError(400, 'unsupported', 'box does not support credential bindings')
    }
    if (request.networkPolicy.mode !== 'allow_all') {
      throw new BoxApiError(400, 'unsupported', 'box does not support network policies')
    }
    const response = await this.request<{ box?: BoxInfo }>('POST', '/boxes', {
      headers: { 'Idempotency-Key': randomUUID() },
      body: {
        type: boxSize(request.resources),
        ttlSeconds: request.hardTimeoutMs > 0 ? Math.ceil(request.hardTimeoutMs / 1000) : null,
        env: request.environment,
        noEnv: true,
        from: request.snapshotId,
      },
    })
    const id = response.box?.id
    if (!id) throw new BoxApiError(500, 'invalid_json_response', 'create returned no box id')
    if (request.name) {
      await this.request('PATCH', `/boxes/${id}`, { body: { name: request.name } }).catch(() => undefined)
    }
    const instance = new BoxSandboxInstance(this, id, request.environment)
    try {
      await instance.waitUntil(['ready', 'idle', 'running'], PROVISION_TIMEOUT_MS)
    } catch (error) {
      // Occasional provider-side provisioning flakes land in `error`; delete
      // the dead box and retry the create once rather than surfacing it.
      const isBoxError = error instanceof BoxApiError && error.code === 'box_error'
      await instance.delete().catch(() => undefined)
      if (!isBoxError) throw error
      return this.create(request)
    }
    return instance
  }

  async reconnect(reference: string): Promise<SandboxInstance> {
    const instance = new BoxSandboxInstance(this, reference)
    const state = (await instance.info()).state
    if (state === 'archived') await instance.resume()
    return instance
  }

  restore(snapshotId: string, request: Omit<SandboxCreateRequest, 'snapshotId'>) {
    return this.create({ ...request, snapshotId })
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    await this.request('DELETE', `/named-snapshots/${encodeURIComponent(snapshotId)}`)
  }

  /** Poll an instance until it reaches one of the target box states. */
  async pollBox(boxId: string, targets: BoxState[], timeoutMs: number): Promise<BoxInfo> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const info = await this.getBox(boxId)
      if (targets.includes(info.state)) return info
      if (info.state === 'error') {
        throw new BoxApiError(409, 'box_error', `box ${boxId} entered error state`)
      }
      if (Date.now() > deadline) {
        throw new BoxApiError(408, 'poll_timeout', `box ${boxId} did not reach ${targets.join('/')} within ${timeoutMs}ms`)
      }
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(50, deadline - Date.now())))
    }
  }

  async getBox(boxId: string): Promise<BoxInfo> {
    const response = await this.request<{ box?: BoxInfo }>('GET', `/boxes/${boxId}`)
    if (!response.box) throw new BoxApiError(500, 'invalid_json_response', 'box info returned no box')
    return response.box
  }
}

class BoxSandboxInstance implements DesktopSandboxInstance {
  readonly provider = 'box' as const
  readonly capabilities = CAPABILITIES
  readonly reference: string
  readonly name: string
  private environment: Record<string, string>
  private deleted = false

  constructor(
    private readonly runtime: BoxSandboxRuntime,
    reference: string,
    environment?: Record<string, string>,
  ) {
    this.reference = reference
    this.name = reference
    this.environment = { ...environment }
  }

  async info(): Promise<BoxInfo> {
    return this.runtime.getBox(this.reference)
  }

  async status(): Promise<SandboxLifecycleState> {
    if (this.deleted) return 'deleted'
    try {
      return boxLifecycle((await this.info()).state)
    } catch (error) {
      if (error instanceof BoxApiError && error.status === 404) {
        this.deleted = true
        return 'deleted'
      }
      throw error
    }
  }

  async workingDirectory(): Promise<string> {
    return WORK_DIR
  }

  async waitUntil(targets: BoxState[], timeoutMs: number) {
    return this.runtime.pollBox(this.reference, targets, timeoutMs)
  }

  async resume(): Promise<void> {
    await this.runtime.request('POST', `/boxes/${this.reference}/resume`, { body: {} })
    await this.waitUntil(['ready', 'idle', 'running'], PROVISION_TIMEOUT_MS)
  }

  async stop(): Promise<void> {
    await this.runtime.request('POST', `/boxes/${this.reference}/stop`, { body: {} })
    await this.waitUntil(['archived'], STOP_TIMEOUT_MS)
  }

  async delete(): Promise<void> {
    if (this.deleted) return
    // The confirm header must equal the box id — the provider's own two-step.
    await this.runtime.request('DELETE', `/boxes/${this.reference}`, {
      headers: { 'X-Ascii-Confirm-Delete': this.reference },
    })
    this.deleted = true
  }

  async fork(request?: {
    name?: string
    environment?: Record<string, string>
    resources?: SandboxResources
    hardTimeoutMs?: number
  }): Promise<SandboxInstance> {
    const response = await this.runtime.request<{ id?: string; box?: BoxInfo }>(
      'POST',
      `/boxes/${this.reference}/fork`,
      {
        headers: { 'Idempotency-Key': randomUUID() },
        body: {
          type: request?.resources ? boxSize(request.resources) : undefined,
          ttlSeconds: request?.hardTimeoutMs ? Math.ceil(request.hardTimeoutMs / 1000) : 3600,
          env: request?.environment,
        },
      },
    )
    const id = response.id ?? response.box?.id
    if (!id) throw new BoxApiError(500, 'invalid_json_response', 'fork returned no box id')
    const instance = new BoxSandboxInstance(this.runtime, id, request?.environment)
    await instance.waitUntil(['ready', 'idle', 'running'], PROVISION_TIMEOUT_MS)
    return instance
  }

  async desktop(options: {
    mode?: 'webrtc' | 'vnc'
    theme?: 'light' | 'dark'
    publicAccess?: boolean
  } = {}): Promise<DesktopStreamTicket> {
    const response = await this.runtime.request<{
      provisioning?: boolean
      desktopUrl?: string
      mode?: string
    }>('POST', `/boxes/${this.reference}/desktop`, {
      query: {
        ...(options.mode === 'vnc' ? { vnc: '1' } : {}),
        ...(options.theme ? { theme: options.theme } : {}),
      },
      body: options.publicAccess !== undefined ? { publicAccess: options.publicAccess } : {},
    })
    if (response.provisioning || !response.desktopUrl) return { ready: false }
    return {
      ready: true,
      url: response.desktopUrl,
      mode: response.mode === 'vnc' ? 'vnc' : 'webrtc',
    }
  }

  async runCommand(request: SandboxCommandRequest): Promise<SandboxCommandHandle> {
    const command = shellJoin(request.command, request.args, this.environment)
    const response = await this.runtime.request<{
      processId?: number
      pid?: number
    }>('POST', `/boxes/${this.reference}/commands`, {
      body: { command, cwd: request.cwd, detached: true },
    })
    if (response.processId === undefined) {
      throw new BoxApiError(500, 'invalid_json_response', 'command start returned no processId')
    }
    return new BoxCommandHandle(this.runtime, this.reference, response.processId, response.pid, request)
  }

  async writeFiles(files: Array<{ path: string; contents: Uint8Array; mode?: number }>): Promise<void> {
    for (const file of files) {
      await this.runtime.request('PUT', `/boxes/${this.reference}/files`, {
        body: { path: file.path, content: Buffer.from(file.contents).toString('base64'), encoding: 'base64' },
      })
    }
  }

  async readFile(path: string): Promise<Uint8Array | null> {
    try {
      const response = await this.runtime.request<{ content?: string }>(
        'GET',
        `/boxes/${this.reference}/files`,
        { query: { path, encoding: 'base64' } },
      )
      return response.content === undefined ? null : new Uint8Array(Buffer.from(response.content, 'base64'))
    } catch (error) {
      if (error instanceof BoxApiError && (error.status === 404 || error.status === 400)) return null
      throw error
    }
  }

  async listFiles(path: string): Promise<SandboxFileEntry[]> {
    // No list endpoint in the API — emulate over the command channel.
    const handle = await this.runCommand({
      command: 'find',
      args: [path, '-mindepth', '1', '-maxdepth', '1', '-printf', '%y\t%s\t%p\n'],
      timeoutMs: 15_000,
    })
    const result = await handle.wait()
    if (result.exitCode !== 0) return []
    return result.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [kind, size, ...rest] = line.split('\t')
      return {
        path: rest.join('\t'),
        kind: kind === 'f' ? 'file' : kind === 'd' ? 'directory' : kind === 'l' ? 'symlink' : 'other',
        size: size ? Number(size) : undefined,
      } satisfies SandboxFileEntry
    })
  }

  async updateEnvironment(environment: Record<string, string>, unset?: string[]): Promise<void> {
    // Box env is fixed at create/fork time. Emulate updates by prefixing them
    // onto every subsequent command; nothing here reaches the box's own env.
    for (const key of unset ?? []) delete this.environment[key]
    Object.assign(this.environment, environment)
  }

  async updateNetworkPolicy(): Promise<void> {
    throw new BoxApiError(400, 'unsupported', 'box does not support network policy updates')
  }

  async port(port: number): Promise<SandboxPort> {
    const response = await this.runtime.request<{ url?: string }>(
      'POST',
      `/boxes/${this.reference}/host`,
      { body: { port } },
    )
    if (!response.url) throw new BoxApiError(500, 'invalid_json_response', 'host returned no url')
    return { port, url: response.url, access: 'private' }
  }

  async snapshot(): Promise<SandboxSnapshot> {
    // Named-snapshot names are [a-z0-9-]{1,63}; box ids carry underscores.
    const name = `ov-${this.reference.replace(/[^a-z0-9-]/g, '')}-${Date.now().toString(36)}`
    await this.runtime.request('POST', '/named-snapshots', {
      body: { boxId: this.reference, name },
    })
    const deadline = Date.now() + SNAPSHOT_TIMEOUT_MS
    for (;;) {
      const response = await this.runtime.request<{
        snapshot?: { status?: string; error?: string }
      }>('GET', `/named-snapshots/${encodeURIComponent(name)}`)
      if (response.snapshot?.status === 'ready') return { id: name, createdAt: Date.now() }
      if (response.snapshot?.status === 'failed') {
        throw new BoxApiError(409, 'snapshot_failed', response.snapshot.error ?? 'named snapshot failed')
      }
      if (Date.now() > deadline) {
        throw new BoxApiError(408, 'poll_timeout', `named snapshot ${name} did not become ready`)
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  async usage(): Promise<SandboxUsage> {
    return {}
  }

  rawProviderDiagnosticHandle(): unknown {
    return { boxId: this.reference }
  }
}

type BoxCommandStatus = {
  running?: boolean
  status?: 'running' | 'exited' | 'lost'
  exitCode?: number | null
  signal?: string | null
  stdout?: string
  stderr?: string
  startedAt?: string | null
  finishedAt?: string | null
}

class BoxCommandHandle implements SandboxCommandHandle {
  readonly id: string
  private readonly queue = new AsyncQueue<SandboxCommandEvent>()
  private readonly resultPromise: Promise<SandboxCommandResult>
  private sequence = 0
  private seenStdout = 0
  private seenStderr = 0

  constructor(
    private readonly runtime: BoxSandboxRuntime,
    private readonly boxId: string,
    processId: number,
    private readonly pid: number | undefined,
    private readonly request: SandboxCommandRequest,
  ) {
    this.id = String(processId)
    this.resultPromise = this.poll()
  }

  events(): AsyncIterable<SandboxCommandEvent> {
    return this.queue
  }

  wait(): Promise<SandboxCommandResult> {
    return this.resultPromise
  }

  async cancel(): Promise<void> {
    if (this.pid === undefined) return
    await this.runtime.request('POST', `/boxes/${this.boxId}/commands`, {
      body: { command: `kill -TERM ${this.pid}`, detached: true },
    }).catch(() => undefined)
  }

  private async poll(): Promise<SandboxCommandResult> {
    const deadline = Date.now() + this.request.timeoutMs
    const onAbort = () => void this.cancel()
    this.request.signal?.addEventListener('abort', onAbort)
    try {
      for (;;) {
        const status = await this.status()
        this.emit(status)
        if (status.running === false || status.status === 'exited' || status.status === 'lost') {
          this.queue.close()
          return {
            commandId: this.id,
            exitCode: status.exitCode ?? (status.signal ? 128 + signalNumber(status.signal) : -1),
            stdout: status.stdout ?? '',
            stderr: status.stderr ?? '',
            startedAt: status.startedAt ? Date.parse(status.startedAt) : Date.now(),
            endedAt: status.finishedAt ? Date.parse(status.finishedAt) : Date.now(),
          }
        }
        if (Date.now() > deadline) {
          await this.cancel()
          this.queue.close()
          return {
            commandId: this.id,
            exitCode: 124,
            stdout: status.stdout ?? '',
            stderr: `${status.stderr ?? ''}\ncommand timed out`,
            startedAt: status.startedAt ? Date.parse(status.startedAt) : Date.now(),
            endedAt: Date.now(),
          }
        }
        await sleep(POLL_INTERVAL_MS)
      }
    } catch (error) {
      this.queue.close()
      throw error
    } finally {
      this.request.signal?.removeEventListener('abort', onAbort)
    }
  }

  private async status(): Promise<BoxCommandStatus> {
    return this.runtime.request<BoxCommandStatus>(
      'GET',
      `/boxes/${this.boxId}/commands/${this.id}`,
    )
  }

  private emit(status: BoxCommandStatus) {
    if (status.stdout && status.stdout.length > this.seenStdout) {
      this.queue.push({
        sequence: this.sequence++,
        stream: 'stdout',
        data: status.stdout.slice(this.seenStdout),
        occurredAt: Date.now(),
      })
      this.seenStdout = status.stdout.length
    }
    if (status.stderr && status.stderr.length > this.seenStderr) {
      this.queue.push({
        sequence: this.sequence++,
        stream: 'stderr',
        data: status.stderr.slice(this.seenStderr),
        occurredAt: Date.now(),
      })
      this.seenStderr = status.stderr.length
    }
  }
}

function boxLifecycle(state: BoxState): SandboxLifecycleState {
  switch (state) {
    case 'init':
    case 'provisioning':
    case 'provisioned':
    case 'cloning':
      return 'provisioning'
    case 'ready':
    case 'idle':
    case 'running':
      return 'running'
    case 'archiving':
    case 'archived':
      return 'stopped'
    case 'error':
      return 'failed'
    default:
      return 'failed'
  }
}

function boxSize(resources?: SandboxResources): string {
  const vcpus = resources?.vcpus ?? 4
  if (vcpus <= 2) return 'small'
  if (vcpus <= 4) return 'default'
  return 'large'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Join command + args into the single shell string the commands endpoint takes,
 *  prefixing the instance's emulated environment. */
function shellJoin(command: string, args: string[] | undefined, environment: Record<string, string>): string {
  const argv = [command, ...(args ?? []).map(shellQuote)].join(' ')
  const env = Object.entries(environment)
  if (env.length === 0) return argv
  const prefix = env.map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ')
  return `env ${prefix} ${argv}`
}

function signalNumber(signal: string): number {
  const numbers: Record<string, number> = { TERM: 15, KILL: 9, INT: 2, HUP: 1 }
  return numbers[signal.replace(/^SIG/, '')] ?? 15
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
