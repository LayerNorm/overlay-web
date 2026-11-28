import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { createMCPClient, type MCPClient, type MCPTransport } from '@ai-sdk/mcp'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool, ToolSet } from 'ai'
import type { LocalMcpServer } from './private-threads-protocol.js'

/**
 * MCP servers that run on this computer (stdio), for private threads. Overlay Desktop keeps the person's list and
 * their environment values in the Keychain and passes them with each turn; this pool starts a server the first time a
 * turn needs it, shares it between turns, stops it after it has been idle for a while, and stops every server when the
 * host quits. Their tools ask for approval in Ask mode, like the computer tools that run commands.
 */

/** Marks a host that runs local MCP servers; Overlay Desktop looks for it in the bundled host before offering them. */
export const LOCAL_MCP_FEATURE = 'overlay-private-local-mcp-servers'

const IDLE_MS = 10 * 60_000
const START_TIMEOUT_MS = 60_000
const MAX_TOOL_NAME = 64
const STDERR_TAIL = 2_000

export type LocalMcpConnection = { tools: ToolSet; instructions?: string; close: () => Promise<void> }
export type LocalMcpConnect = (server: LocalMcpServer, signal: AbortSignal) => Promise<LocalMcpConnection>

type Entry = {
  key: string
  server: LocalMcpServer
  connection: Promise<LocalMcpConnection>
  users: number
  idle?: NodeJS.Timeout
  stderr: string[]
}

export type LocalMcpTurn = {
  tools: ToolSet
  /** Tells the model where these tools come from, and which servers could not start. */
  instructions: string
  release: () => void
}

export class LocalMcpServers {
  private readonly entries = new Map<string, Entry>()
  private closed = false

  constructor(private readonly options: {
    connect?: LocalMcpConnect
    idleMs?: number
    startTimeoutMs?: number
    log?: (message: string) => void
  } = {}) {}

  /** Ids of the servers running now. */
  running(): string[] {
    return [...this.entries.values()].map(entry => entry.server.id)
  }

  /** The tools of these servers for one turn. A server that fails to start is left out and named in the instructions. */
  async open(servers: LocalMcpServer[], options: { signal: AbortSignal; approvalMode: 'ask' | 'auto' }): Promise<LocalMcpTurn> {
    const tools: ToolSet = {}
    const used: Entry[] = []
    const failed: string[] = []
    const names = new Set<string>()
    const results = await Promise.all(servers.map(async (server) => {
      const entry = this.acquire(server)
      used.push(entry)
      try {
        return { server, connection: await untilAborted(entry.connection, options.signal) }
      } catch (error) {
        if (!options.signal.aborted) failed.push(`${server.name} (${errorText(error, entry)})`)
        return { server, connection: null }
      }
    }))
    for (const { server, connection } of results) {
      if (!connection) continue
      for (const [name, definition] of Object.entries(connection.tools)) {
        const toolName = uniqueName(localMcpToolName(server.name, name), names)
        names.add(toolName)
        tools[toolName] = asApprovedTool(definition, server.name, name, options.approvalMode)
      }
    }
    let released = false
    const release = () => {
      if (released) return
      released = true
      for (const entry of used) this.release(entry)
    }
    const prefixes = results.filter(result => result.connection).map(result => `${localMcpToolName(result.server.name, '')}*`)
    const instructions = [
      prefixes.length
        ? `Tools named ${prefixes.join(', ')} come from MCP servers the person runs on this computer. The person approves each call unless they chose Auto.`
        : '',
      failed.length ? `These MCP servers on this computer could not start for this turn: ${failed.join('; ')}.` : '',
    ].filter(Boolean).join('\n')
    return { tools, instructions, release }
  }

  /** Starts a server (or reuses it) and lists its tools, for Settings. */
  async check(server: LocalMcpServer): Promise<{ tools: { name: string; description: string }[] }> {
    const entry = this.acquire(server)
    try {
      const connection = await entry.connection.catch((error: unknown) => { throw new Error(errorText(error, entry)) })
      return {
        tools: Object.entries(connection.tools).map(([name, definition]) => ({ name, description: describe(definition).slice(0, 300) })),
      }
    } finally {
      this.release(entry)
    }
  }

  /** Stops a server now (it was removed or changed in Settings). Turns using it keep their tools until they end. */
  async stop(serverId: string): Promise<boolean> {
    const entry = this.entries.get(serverId)
    if (!entry) return false
    await this.close(entry)
    return true
  }

  /** Stops every server: the host is quitting. */
  async shutdown(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.entries.values()].map(entry => this.close(entry)))
  }

  private acquire(server: LocalMcpServer): Entry {
    if (this.closed) throw new Error('Private threads are stopping.')
    const key = configKey(server)
    let entry = this.entries.get(server.id)
    if (entry && entry.key !== key) {
      // Changed in Settings: the old process goes, the new one starts.
      void this.close(entry)
      entry = undefined
    }
    if (!entry) {
      const stderr: string[] = []
      const created: Entry = { key, server, users: 0, stderr, connection: Promise.resolve(null as never) }
      created.connection = this.start(server, stderr)
      // A server that fails to start is forgotten, so the next turn tries again.
      created.connection.catch(() => { if (this.entries.get(server.id) === created) this.entries.delete(server.id) })
      this.entries.set(server.id, created)
      entry = created
    }
    if (entry.idle) { clearTimeout(entry.idle); entry.idle = undefined }
    entry.users++
    return entry
  }

  private release(entry: Entry): void {
    entry.users = Math.max(0, entry.users - 1)
    if (entry.users > 0 || this.entries.get(entry.server.id) !== entry) return
    entry.idle = setTimeout(() => void this.close(entry), this.options.idleMs ?? IDLE_MS)
    entry.idle.unref?.()
  }

  private async close(entry: Entry): Promise<void> {
    if (entry.idle) clearTimeout(entry.idle)
    if (this.entries.get(entry.server.id) === entry) this.entries.delete(entry.server.id)
    const connection = await entry.connection.catch(() => null)
    await connection?.close().catch(() => undefined)
  }

  private async start(server: LocalMcpServer, stderr: string[]): Promise<LocalMcpConnection> {
    const signal = AbortSignal.timeout(this.options.startTimeoutMs ?? START_TIMEOUT_MS)
    const connect = this.options.connect ?? ((value, abort) => connectStdio(value, abort, (text) => {
      stderr.push(text)
      while (stderr.join('').length > STDERR_TAIL) stderr.shift()
    }))
    const attempt = connect(server, signal)
    const connection = await untilAborted(attempt, signal).catch((error: unknown) => {
      if (!signal.aborted) throw error
      // A connection that finishes after the deadline belongs to no entry, so nothing else would ever stop it.
      attempt.then(late => late.close().catch(() => undefined), () => undefined)
      throw new Error('it did not answer within a minute')
    })
    this.options.log?.(`Local MCP server ${server.name} started with ${Object.keys(connection.tools).length} tools.`)
    return connection
  }
}

async function connectStdio(server: LocalMcpServer, signal: AbortSignal, onStderr: (text: string) => void): Promise<LocalMcpConnection> {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    // Only the basics of this process's environment (home, user, PATH…), then what the person set for this server.
    env: { ...getDefaultEnvironment(), ...server.env },
    cwd: server.cwd ?? homedir(),
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk: Buffer) => onStderr(chunk.toString()))
  // Past the deadline the process is stopped, so a slow tool listing fails instead of finishing unseen.
  const stopAtDeadline = () => void transport.close().catch(() => undefined)
  signal.addEventListener('abort', stopAtDeadline, { once: true })
  let client: MCPClient | null = null
  try {
    client = await createMCPClient({
      transport: transport as unknown as MCPTransport,
      clientName: 'overlay-private-thread',
      initializationOptions: { signal },
    })
    const connected = client
    const tools = await connected.tools() as ToolSet
    signal.throwIfAborted()
    signal.removeEventListener('abort', stopAtDeadline)
    return {
      tools,
      ...(connected.instructions?.trim() ? { instructions: connected.instructions.trim() } : {}),
      close: async () => { await connected.close().catch(() => undefined); await transport.close().catch(() => undefined) },
    }
  } catch (error) {
    signal.removeEventListener('abort', stopAtDeadline)
    await client?.close().catch(() => undefined)
    await transport.close().catch(() => undefined)
    throw error
  }
}

/** `server__tool`, in the characters and length every model provider accepts for tool names. */
export function localMcpToolName(serverName: string, toolName: string): string {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  const server = (clean(serverName) || 'mcp').slice(0, 24)
  return `${server}__${clean(toolName)}`.slice(0, MAX_TOOL_NAME)
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  for (let index = 2; ; index++) {
    const candidate = `${name.slice(0, MAX_TOOL_NAME - 3)}_${index}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * A static tool (so the page shows its row and approval card like any other tool) that runs the server's tool. In Ask
 * mode every call waits for the person: a local server can do anything its command can.
 */
function asApprovedTool(definition: Tool, serverName: string, toolName: string, approvalMode: 'ask' | 'auto'): Tool {
  const description = describe(definition) || toolName
  return {
    ...definition,
    type: 'function',
    description: `${description}\n(From the MCP server “${serverName}” on this computer.)`,
    needsApproval: approvalMode === 'ask',
  } as Tool
}

function describe(definition: Tool): string {
  return typeof definition.description === 'string' ? definition.description.trim() : ''
}

function configKey(server: LocalMcpServer): string {
  return createHash('sha256').update(JSON.stringify([server.command, server.args, server.cwd ?? null, Object.entries(server.env).sort()])).digest('hex')
}

/** What went wrong, without environment values, and with the end of the server's own error output. */
function errorText(error: unknown, entry: Entry): string {
  let message = error instanceof Error ? error.message : String(error)
  if (/ENOENT/.test(message)) message = `${entry.server.command} was not found on this computer`
  const tail = entry.stderr.join('').trim().split(/\r?\n/).slice(-3).join(' ').trim()
  let text = tail && !message.includes(tail) ? `${message}: ${tail}` : message
  for (const value of Object.values(entry.server.env)) {
    if (value.length >= 4) text = text.split(value).join('[hidden]')
  }
  return text.slice(0, 500)
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
