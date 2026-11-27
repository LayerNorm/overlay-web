import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { app, session } from 'electron'
import {
  localModelProviders,
  type Events,
  type Input,
  type LocalModelKeys,
  type LocalModelProvider,
  type Results
} from '@overlay/desktop-bridge'
import { emitDesktopEvent } from './desktop-events'
import { resolveEmbeddedHostRuntime } from './embedded-host-config'
import { createLocalHelperEnvironment } from './security/local-helper-process'
import { safeStorageService } from './security/safe-storage-service'
import { ensureLocalComputerWorkFolder } from './local-computer'
import { getWebShellOrigin, WEB_SHELL_PARTITION } from './web-shell'

/**
 * Private threads ("Cloud sync" off) run in the bundled Agent Host, started as
 * `overlay-agent-host private` with a Node.js IPC channel and no network port.
 * This process keeps the person's model keys in the system keychain and hands
 * one to the host only for the run that needs it. Transcripts stay in the
 * host's SQLite file under the app's data folder.
 */
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }
type HostMessage =
  | { type: 'ready' }
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string }
  | { type: 'event'; event: HostEvent }
type HostEvent =
  | ({ kind: 'chunk' } & Events['localThreads.chunk'])
  | ({ kind: 'turn' } & Events['localThreads.turn'])
  | { kind: 'threads'; owner: Events['localThreads.threads'] }

const KEY_PREFIX = 'private-model-key-'
const START_TIMEOUT_MS = 15_000
const OVERLAY_TOOLS_TIMEOUT_MS = 15_000

class PrivateThreadsService {
  private supported: boolean | null = null
  private child: ChildProcess | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  /** Advertised only when the bundled Agent Host has the `private` command (0.6.0 and later). */
  isSupported(): boolean {
    if (this.supported !== null) return this.supported
    const runtime = resolveEmbeddedHostRuntime({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath()
    })
    try {
      this.supported = Boolean(runtime && readFileSync(runtime.cliPath, 'utf8').includes('overlay-agent-host private --state-dir'))
    } catch {
      this.supported = false
    }
    return this.supported
  }

  private stateDirectory(): string {
    return join(app.getPath('userData'), 'private-threads')
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    const runtime = resolveEmbeddedHostRuntime({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath()
    })
    if (!runtime) {
      return Promise.reject(new Error(app.isPackaged
        ? 'This copy of Overlay is missing the part that runs threads on this computer. Reinstall Overlay.'
        : 'The agent host bundle is not built. Run `npm run build:agent-host`.'))
    }
    const stateDirectory = this.stateDirectory()
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
    const child = spawn(runtime.nodePath, [runtime.cliPath, 'private', '--state-dir', stateDirectory], {
      env: createLocalHelperEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true
    })
    this.child = child
    child.stdout?.resume()
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text && !text.includes('ExperimentalWarning')) console.warn('[PrivateThreads]', text.slice(0, 2_000))
    })
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error('Private threads did not start in time.')), START_TIMEOUT_MS)
      child.on('message', (message: HostMessage) => {
        if (message?.type === 'ready') { clearTimeout(timer); resolveReady() }
        else this.receive(message)
      })
      child.once('exit', () => { clearTimeout(timer); rejectReady(new Error('Private threads stopped unexpectedly.')) })
      child.once('error', (error) => { clearTimeout(timer); rejectReady(error) })
    })
    child.once('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.ready = null
      for (const [id, pending] of this.pending) {
        pending.reject(new Error('Private threads stopped. Try again.'))
        this.pending.delete(id)
      }
    })
    this.ready.catch(() => {
      if (this.child === child) { child.kill('SIGTERM'); this.child = null; this.ready = null }
    })
    return this.ready
  }

  private receive(message: HostMessage): void {
    if (message?.type === 'response') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error))
    } else if (message?.type === 'event') {
      const { event } = message
      if (event.kind === 'chunk') emitDesktopEvent('localThreads.chunk', { threadId: event.threadId, turnId: event.turnId, chunk: event.chunk })
      else if (event.kind === 'turn') emitDesktopEvent('localThreads.turn', {
        threadId: event.threadId, turnId: event.turnId, state: event.state, ...(event.error ? { error: event.error } : {})
      })
      else if (event.kind === 'threads') emitDesktopEvent('localThreads.threads', event.owner)
    }
  }

  private async request<T>(request: Record<string, unknown>): Promise<T> {
    await this.start()
    const child = this.child
    if (!child?.connected) throw new Error('Private threads are not running. Try again.')
    const id = this.nextId++
    return await new Promise<T>((resolvePromise, reject) => {
      this.pending.set(id, { resolve: value => resolvePromise(value as T), reject })
      child.send({ type: 'request', id, request }, (error) => {
        if (!error) return
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  list(input: Input<'localThreads.list'>) {
    return this.request<Results['localThreads.list']>({ method: 'list', owner: input.owner })
  }

  get(input: Input<'localThreads.get'>) {
    return this.request<Results['localThreads.get']>({ method: 'get', owner: input.owner, threadId: input.threadId })
  }

  async create(input: Input<'localThreads.create'>) {
    const folder = input.folder ? resolve(input.folder) : null
    if (folder && !folderAllowed(folder)) {
      throw new Error('Choose this folder on this computer first.')
    }
    return await this.request<Results['localThreads.create']>({
      method: 'create', owner: input.owner, threadId: input.threadId, agentId: input.agentId,
      title: 'New thread', folder, model: null
    })
  }

  async send(input: Input<'localThreads.send'>) {
    const apiKey = readKey(input.model.provider)
    if (!apiKey) throw new Error('Add a key for this model provider in Settings → Desktop first.')
    const { thread } = await this.get({ owner: input.owner, threadId: input.threadId })
    const roots = [thread.folder ?? ensureLocalComputerWorkFolder()]
    const overlay = await overlayToolsAccess(input.owner.workspaceId, thread.agentId)
    return await this.request<Results['localThreads.send']>({
      method: 'send', owner: input.owner, threadId: input.threadId, turnId: input.turnId,
      messages: input.messages, model: { ...input.model, apiKey }, agent: input.agent,
      roots, approvalMode: input.approvalMode, ...(overlay ? { overlay } : {})
    })
  }

  stop(input: Input<'localThreads.stop'>) {
    return this.request<Results['localThreads.stop']>({ method: 'stop', owner: input.owner, threadId: input.threadId })
  }

  async update(input: Input<'localThreads.update'>) {
    const folder = input.folder ? resolve(input.folder) : input.folder
    if (folder && !folderAllowed(folder)) throw new Error('Choose this folder on this computer first.')
    return await this.request<Results['localThreads.update']>({
      method: 'update', owner: input.owner, threadId: input.threadId,
      ...(input.title ? { title: input.title } : {}),
      ...(folder !== undefined ? { folder } : {})
    })
  }

  delete(input: Input<'localThreads.delete'>) {
    return this.request<Results['localThreads.delete']>({ method: 'delete', owner: input.owner, threadId: input.threadId })
  }

  keys(): LocalModelKeys {
    return Object.fromEntries(localModelProviders.map(provider => [provider, Boolean(readKey(provider))])) as LocalModelKeys
  }

  async setKey(input: Input<'localThreads.setKey'>): Promise<LocalModelKeys> {
    if (input.apiKey === null) {
      safeStorageService.deleteSecureValue(`${KEY_PREFIX}${input.provider}`)
      return this.keys()
    }
    // A key is stored only once its provider accepts it.
    await this.request({ method: 'models', provider: input.provider, apiKey: input.apiKey })
    if (!safeStorageService.storeSecureValue(`${KEY_PREFIX}${input.provider}`, input.apiKey)) {
      throw new Error('The system keychain could not store this key.')
    }
    return this.keys()
  }

  async models(input: Input<'localThreads.models'>): Promise<Results['localThreads.models']> {
    const apiKey = readKey(input.provider)
    if (!apiKey) return { models: [] }
    return await this.request<Results['localThreads.models']>({ method: 'models', provider: input.provider, apiKey })
  }

  /** Signing out or quitting stops private runs; their transcripts are kept up to the last step. */
  stopAll(): void {
    const child = this.child
    if (!child) return
    this.child = null
    this.ready = null
    if (child.connected) child.disconnect()
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM') }, 3_000).unref()
  }
}

function readKey(provider: LocalModelProvider): string | null {
  return safeStorageService.getSecureValue(`${KEY_PREFIX}${provider}`)
}

/**
 * Folders the person chose in the system folder dialog, the work folder and the
 * folders already approved for this computer. A page cannot name any other folder.
 */
const chosenFoldersPath = () => join(app.getPath('userData'), 'private-threads', 'folders.json')

export function rememberChosenFolder(path: string): void {
  try {
    const folders = chosenFolders()
    if (folders.includes(path)) return
    mkdirSync(join(app.getPath('userData'), 'private-threads'), { recursive: true, mode: 0o700 })
    writeFileSync(chosenFoldersPath(), `${JSON.stringify([path, ...folders].slice(0, 200))}\n`, { mode: 0o600 })
  } catch {
    /* A folder that is not remembered can be chosen again. */
  }
}

function chosenFolders(): string[] {
  try {
    const value = JSON.parse(readFileSync(chosenFoldersPath(), 'utf8')) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function approvedHostFolders(): string[] | 'all' {
  try {
    const path = join(app.getPath('userData'), 'agent-host', 'connection.json')
    if (!existsSync(path)) return []
    const grant = (JSON.parse(readFileSync(path, 'utf8')) as { filesystemGrant?: { mode?: string; roots?: unknown } }).filesystemGrant
    if (grant?.mode === 'all_user_files') return 'all'
    return Array.isArray(grant?.roots) ? grant.roots.filter((root): root is string => typeof root === 'string') : []
  } catch {
    return []
  }
}

function folderAllowed(folder: string): boolean {
  const within = (root: string) => folder === root || folder.startsWith(`${root.endsWith(sep) ? root : root + sep}`)
  const approved = approvedHostFolders()
  if (approved === 'all') return within(homedir())
  return [join(homedir(), 'Overlay Files'), ...chosenFolders(), ...approved].some(within)
}

export const privateThreadsService = new PrivateThreadsService()

/**
 * The agent's Overlay tools for one turn: a short-lived token for Overlay's MCP server, asked for with this app's own
 * signed-in session so the page never holds it. It names the person, workspace and agent, never the conversation.
 * Without one (signed out, offline, older server) the turn runs with this computer's tools only.
 */
async function overlayToolsAccess(workspaceId: string, agentId: string): Promise<{ url: string; token: string } | null> {
  const origin = getWebShellOrigin()
  try {
    const response = await session.fromPartition(WEB_SHELL_PARTITION).fetch(`${origin}/api/v1/mcp/private-thread`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `desktop:${randomUUID()}`, Referer: `${origin}/app` },
      body: JSON.stringify({ workspaceId, agentId }),
      redirect: 'error',
      signal: AbortSignal.timeout(OVERLAY_TOOLS_TIMEOUT_MS)
    })
    if (!response.ok) return null
    const body = (await response.json()) as { token?: unknown }
    if (typeof body.token !== 'string') return null
    // The token only ever goes to this app's own Overlay server.
    return { url: `${origin}/api/mcp`, token: body.token }
  } catch {
    return null
  }
}
