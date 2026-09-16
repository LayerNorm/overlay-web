/**
 * `HarnessV1SandboxProvider` bridge — maps Overlay's provider-neutral
 * `SandboxRuntime`/`SandboxInstance` contract onto the AI SDK harness sandbox
 * surface (`HarnessV1NetworkSandboxSession`) so managed HarnessAgents can run
 * on any provider the runtime supports (Daytona today; Box once its
 * egress-policy and keys-in-sandbox gaps are closed).
 *
 * Vercel stays on its native `@ai-sdk/sandbox-vercel` provider because it is
 * the only sandbox with request transformations — the boundary where model
 * credentials are injected without ever entering the sandbox environment.
 *
 * This module is type-only against `@ai-sdk/harness`/`ai`: it builds plain
 * objects that satisfy the harness contracts, so the package carries no
 * runtime dependency on the harness graph.
 *
 * See `docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`, Phase 4.
 */

import type {
  HarnessV1NetworkPolicy,
  HarnessV1NetworkSandboxSession,
  HarnessV1PortEndpoint,
  HarnessV1SandboxProvider,
} from '@ai-sdk/harness'
import type {
  Experimental_SandboxProcess,
  Experimental_SandboxSession,
} from 'ai'
import { randomUUID } from 'node:crypto'
import type {
  SandboxCommandHandle,
  SandboxInstance,
  SandboxNetworkPolicy,
  SandboxRuntime,
} from './contracts'

/**
 * Long ceiling for harness-spawned processes — bridge daemons and builds run
 * for the life of the session; the provider idle/hard timeouts are the real
 * bound, and the harness cancels early via `abortSignal`.
 */
const HARNESS_PROCESS_TIMEOUT_MS = 24 * 60 * 60_000

const textEncoder = new TextEncoder()

/** Demux a command's interleaved stdout/stderr events into two byte streams. */
function demuxCommandEvents(handle: SandboxCommandHandle): {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
} {
  // `start` runs synchronously in the ReadableStream constructor, so both
  // controllers are assigned before the pump below begins.
  let stdoutController!: ReadableStreamDefaultController<Uint8Array>
  let stderrController!: ReadableStreamDefaultController<Uint8Array>
  const stdout = new ReadableStream<Uint8Array>({
    start: (controller) => { stdoutController = controller },
  })
  const stderr = new ReadableStream<Uint8Array>({
    start: (controller) => { stderrController = controller },
  })
  void (async () => {
    try {
      for await (const event of handle.events()) {
        const bytes = textEncoder.encode(event.data)
        if (event.stream === 'stdout') stdoutController.enqueue(bytes)
        else stderrController.enqueue(bytes)
      }
      stdoutController.close()
      stderrController.close()
    } catch (error) {
      stdoutController.error(error)
      stderrController.error(error)
    }
  })()
  return { stdout, stderr }
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function toSandboxNetworkPolicy(policy: HarnessV1NetworkPolicy): SandboxNetworkPolicy {
  if (policy.mode === 'allow-all') return { mode: 'allow_all' }
  if (policy.mode === 'deny-all') return { mode: 'deny_all' }
  return {
    mode: 'allowlist',
    domains: [...(policy.allowedHosts ?? [])],
    allowedCidrs: [...(policy.allowedCIDRs ?? [])],
    deniedCidrs: [...(policy.deniedCIDRs ?? [])],
  }
}

function swapProtocol(url: string, protocol: 'http' | 'https' | 'ws' | undefined): string {
  if (protocol === 'ws') {
    if (url.startsWith('https:')) return `wss:${url.slice('https:'.length)}`
    if (url.startsWith('http:')) return `ws:${url.slice('http:'.length)}`
    return url
  }
  if (protocol === 'http' && url.startsWith('https:')) return `http:${url.slice('https:'.length)}`
  return url
}

export type OverlayHarnessSessionOptions = {
  /** Ports the sandbox exposes — resolvable via `getPortEndpoint`. */
  ports?: readonly number[]
  /** Override the generated session description. */
  description?: string
}

/**
 * Wraps a live `SandboxInstance` as a `HarnessV1NetworkSandboxSession`. The
 * caller keeps ownership of the instance — `destroy`/`stop` forward to it.
 */
export async function overlayHarnessSandboxSession(
  instance: SandboxInstance,
  options: OverlayHarnessSessionOptions = {},
): Promise<HarnessV1NetworkSandboxSession> {
  const ports = [...(options.ports ?? [])]
  const defaultWorkingDirectory = await instance.workingDirectory()
  const description = options.description ?? [
    `Overlay-managed ${instance.provider} sandbox '${instance.name}'.`,
    `Working directory: ${defaultWorkingDirectory}.`,
    ports.length > 0 ? `Exposed ports: ${ports.join(', ')}.` : '',
  ].filter(Boolean).join(' ')

  const spawnProcess = async (spawnOptions: {
    command: string
    workingDirectory?: string
    env?: Record<string, string>
    abortSignal?: AbortSignal
  }): Promise<Experimental_SandboxProcess> => {
    // The runtime contract is argv-style with each arg shell-quoted; the
    // harness passes a shell command string, so it runs under `sh -lc`.
    const handle = await instance.runCommand({
      command: 'sh',
      args: ['-lc', spawnOptions.command],
      cwd: spawnOptions.workingDirectory,
      environment: spawnOptions.env,
      timeoutMs: HARNESS_PROCESS_TIMEOUT_MS,
      signal: spawnOptions.abortSignal,
    })
    const { stdout, stderr } = demuxCommandEvents(handle)
    return {
      stdout,
      stderr,
      wait: async () => ({ exitCode: (await handle.wait()).exitCode }),
      kill: async () => handle.cancel(),
    }
  }

  const readBinaryFile = async (readOptions: { path: string }) =>
    await instance.readFile(readOptions.path)

  const writeBinaryFile = async (writeOptions: { path: string; content: Uint8Array }) => {
    await instance.writeFiles([{ path: writeOptions.path, contents: writeOptions.content }])
  }

  const session: Experimental_SandboxSession = {
    description,
    readFile: async ({ path }) => {
      const bytes = await readBinaryFile({ path })
      return bytes ? bytesToStream(bytes) : null
    },
    readBinaryFile,
    readTextFile: async ({ path, encoding, startLine, endLine }) => {
      const bytes = await readBinaryFile({ path })
      if (!bytes) return null
      const text = new TextDecoder(encoding ?? 'utf-8').decode(bytes)
      const start = startLine ?? 1
      if (start === 1 && endLine === undefined) return text
      return text.split('\n').slice(start - 1, endLine).join('\n')
    },
    writeFile: async ({ path, content }) => {
      await writeBinaryFile({ path, content: await streamToBytes(content) })
    },
    writeBinaryFile,
    writeTextFile: async ({ path, content }) => {
      await writeBinaryFile({ path, content: textEncoder.encode(content) })
    },
    spawn: spawnProcess,
    run: async (runOptions) => {
      const process = await spawnProcess(runOptions)
      const [stdoutText, stderrText, result] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.wait(),
      ])
      return { exitCode: result.exitCode, stdout: stdoutText, stderr: stderrText }
    },
  }

  const getPortEndpoint = async (endpointOptions: {
    port: number
    protocol?: 'http' | 'https' | 'ws'
  }): Promise<HarnessV1PortEndpoint> => {
    const port = await instance.port(endpointOptions.port)
    return {
      url: swapProtocol(port.url, endpointOptions.protocol),
      ...(port.headers ? { headers: port.headers } : {}),
    }
  }

  return {
    ...session,
    id: instance.reference,
    defaultWorkingDirectory,
    ports,
    getPortEndpoint,
    getPortUrl: async (endpointOptions) => (await getPortEndpoint(endpointOptions)).url,
    stop: () => instance.stop(),
    destroy: () => instance.delete(),
    ...(instance.capabilities.networkPolicyUpdates
      ? { setNetworkPolicy: async (policy) => instance.updateNetworkPolicy(toSandboxNetworkPolicy(policy)) }
      : {}),
    restricted: () => session,
  }
}

export type OverlayHarnessProviderSessionDefaults = {
  /** Deterministic sandbox name prefix; `sessionId` is appended when given. */
  name?: string
  environment?: Record<string, string>
  ports?: readonly number[]
  networkPolicy?: SandboxNetworkPolicy
  idleTimeoutMs?: number
  hardTimeoutMs?: number
  resources?: { vcpus?: number; memoryGiB?: number; diskGiB?: number }
  metadata?: Record<string, string>
}

function harnessSandboxName(prefix: string, sessionId?: string): string {
  if (!sessionId) return prefix
  const suffix = sessionId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
  return `${prefix}-${suffix}`.slice(0, 60)
}

/**
 * A `HarnessV1SandboxProvider` over an Overlay `SandboxRuntime`. The harness
 * framework calls `createSession`/`resumeSession` itself; the sandbox name is
 * derived deterministically from the harness `sessionId` in both paths (the
 * same contract `@ai-sdk/sandbox-vercel` implements), and Overlay runtimes
 * resolve `reconnect` by name as well as by id.
 */
export function createOverlayHarnessSandboxProvider(args: {
  runtime: SandboxRuntime
  session?: OverlayHarnessProviderSessionDefaults
}): HarnessV1SandboxProvider {
  const { runtime, session: defaults = {} } = args
  const namePrefix = defaults.name ?? `overlay-${runtime.provider}-harness`
  const wrap = (instance: SandboxInstance) =>
    overlayHarnessSandboxSession(instance, { ports: defaults.ports })
  return {
    specificationVersion: 'harness-sandbox-v1',
    providerId: `overlay-${runtime.provider}`,
    createSession: async ({ sessionId, abortSignal, onFirstCreate } = {}) => {
      const instance = await runtime.create({
        // Sessionless creates (prewarm) get a unique name so two of them can
        // never collide; resumable creates derive it from `sessionId` — the
        // same derivation `resumeSession` applies.
        name: harnessSandboxName(namePrefix, sessionId ?? randomUUID()),
        persistent: true,
        ...(defaults.environment ? { environment: defaults.environment } : {}),
        ports: [...(defaults.ports ?? [])],
        networkPolicy: defaults.networkPolicy ?? { mode: 'allow_all' },
        idleTimeoutMs: defaults.idleTimeoutMs ?? 0,
        hardTimeoutMs: defaults.hardTimeoutMs ?? HARNESS_PROCESS_TIMEOUT_MS,
        ...(defaults.resources ? { resources: defaults.resources } : {}),
        ...(defaults.metadata ? { metadata: defaults.metadata } : {}),
      })
      const session = await wrap(instance)
      // Overlay runtimes have no snapshot hook — run one-time setup now, like
      // other non-snapshot providers per the contract.
      await onFirstCreate?.(session.restricted(), { abortSignal })
      return session
    },
    resumeSession: async ({ sessionId }) => wrap(await runtime.reconnect(harnessSandboxName(namePrefix, sessionId))),
  }
}

/**
 * Provider variant that wraps an already-provisioned `SandboxInstance` — the
 * managed-turn path owns sandbox lifecycle through the environment lease, so
 * `createSession`/`resumeSession` both return a session over that instance
 * (matching `createVercelSandbox({ sandbox })` wrap semantics: the caller owns
 * the sandbox, `onFirstCreate` is not invoked).
 */
export function createOverlayHarnessInstanceProvider(args: {
  instance: SandboxInstance
  ports?: readonly number[]
}): HarnessV1SandboxProvider {
  const { instance, ports } = args
  const wrap = () => overlayHarnessSandboxSession(instance, { ports })
  return {
    specificationVersion: 'harness-sandbox-v1',
    providerId: `overlay-${instance.provider}`,
    createSession: () => wrap(),
    resumeSession: () => wrap(),
  }
}
