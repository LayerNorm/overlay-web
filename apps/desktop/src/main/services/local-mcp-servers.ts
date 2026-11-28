import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LocalMcpServer } from '@overlay/desktop-bridge'

/**
 * MCP servers that run on this computer (stdio), for private threads (internal/develop/private-threads.md). The list
 * (name, command, arguments, the names of environment values) is a file in the app's data folder; the environment
 * values are one Keychain entry per server. The page gets the list without values; the Agent Host gets the values for
 * the turn that starts the server.
 */

export type LocalMcpSecrets = {
  get(key: string): string | null
  set(key: string, value: string): boolean
  delete(key: string): void
}

type Stored = {
  id: string
  name: string
  command: string
  args: string[]
  cwd: string | null
  envNames: string[]
  /** The scan item it came from, so importing it again updates it instead of adding a copy. */
  importedFrom: { itemId: string; app: string } | null
  addedAt: number
}

/** What the Agent Host needs to start one server: its environment values included. */
export type LocalMcpLaunch = { id: string; name: string; command: string; args: string[]; env: Record<string, string>; cwd?: string }

export type LocalMcpInput = {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string | null
  importedFrom?: { itemId: string; app: string } | null
}

const MAX_SERVERS = 20
const MAX_ENV_CHARS = 60_000
const envKey = (id: string) => `local-mcp-env-${id}`

export class LocalMcpStore {
  constructor(
    private readonly file: string,
    private readonly secrets: LocalMcpSecrets,
    private readonly now: () => number = Date.now,
  ) {}

  /** The list for the page: names of environment values, never the values. */
  list(): LocalMcpServer[] {
    return this.read().map((server) => ({
      id: server.id,
      name: server.name,
      command: server.command,
      args: server.args,
      envNames: server.envNames,
      importedFrom: server.importedFrom?.app ?? null,
      addedAt: server.addedAt,
    }))
  }

  /**
   * Adds a server, or updates the one it already is: the same imported item, or the same command, arguments and folder
   * (the same server set up in two apps). Importing again never adds a copy.
   */
  save(input: LocalMcpInput): { id: string; created: boolean } {
    const servers = this.read()
    const cwd = input.cwd ?? null
    const existing = (input.importedFrom && servers.find((server) => server.importedFrom?.itemId === input.importedFrom!.itemId))
      ?? servers.find((server) => server.command === input.command && sameList(server.args, input.args) && server.cwd === cwd)
    // An import adds to the values the server already has (the same server in two apps may set different ones);
    // adding by hand replaces them.
    const kept = existing && input.importedFrom ? this.withEnv(existing).env : {}
    const env = Object.fromEntries(Object.entries({ ...kept, ...input.env }).filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
    const envText = JSON.stringify(env)
    if (envText.length > MAX_ENV_CHARS) throw new Error('These environment values are too long.')
    if (!existing && servers.length >= MAX_SERVERS) throw new Error(`You can add up to ${MAX_SERVERS} servers on this computer.`)
    const id = existing?.id ?? `lmcp-${randomBytes(8).toString('hex')}`
    const others = servers.filter((server) => server.id !== id)
    const next: Stored = {
      id,
      name: uniqueName(input.name.trim() || 'MCP server', others.map((server) => server.name)),
      command: input.command,
      args: input.args,
      cwd,
      envNames: Object.keys(env).sort(),
      importedFrom: input.importedFrom ?? existing?.importedFrom ?? null,
      addedAt: existing?.addedAt ?? this.now(),
    }
    if (existing) next.name = existing.name
    if (Object.keys(env).length) {
      if (!this.secrets.set(envKey(id), envText)) throw new Error('The system keychain could not store the environment values.')
    } else {
      this.secrets.delete(envKey(id))
    }
    this.write(existing ? servers.map((server) => server.id === id ? next : server) : [...servers, next])
    return { id, created: !existing }
  }

  /** Scan items already brought over as local servers. */
  importedItemIds(): string[] {
    return this.read().flatMap((server) => server.importedFrom ? [server.importedFrom.itemId] : [])
  }

  remove(id: string): boolean {
    const servers = this.read()
    if (!servers.some((server) => server.id === id)) return false
    this.secrets.delete(envKey(id))
    this.write(servers.filter((server) => server.id !== id))
    return true
  }

  /** One server with its environment values, for the Agent Host. */
  launch(id: string): LocalMcpLaunch | null {
    const server = this.read().find((entry) => entry.id === id)
    return server ? this.withEnv(server) : null
  }

  /** Every server with its environment values, for a turn whose agent may use them. */
  launches(): LocalMcpLaunch[] {
    return this.read().map((server) => this.withEnv(server))
  }

  private withEnv(server: Stored): LocalMcpLaunch {
    let env: Record<string, string> = {}
    const text = server.envNames.length ? this.secrets.get(envKey(server.id)) : null
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown
        if (parsed && typeof parsed === 'object') {
          env = Object.fromEntries(Object.entries(parsed).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
        }
      } catch { /* Unreadable values start the server without them; its error says what is missing. */ }
    }
    return { id: server.id, name: server.name, command: server.command, args: server.args, env, ...(server.cwd ? { cwd: server.cwd } : {}) }
  }

  private read(): Stored[] {
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      return Array.isArray(value) ? value.filter(isStored) : []
    } catch {
      return []
    }
  }

  private write(servers: Stored[]): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    writeFileSync(this.file, `${JSON.stringify(servers, null, 2)}\n`, { mode: 0o600 })
  }
}

function isStored(value: unknown): value is Stored {
  const server = value as Stored
  return Boolean(server && typeof server.id === 'string' && typeof server.name === 'string' && typeof server.command === 'string'
    && Array.isArray(server.args) && Array.isArray(server.envNames))
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((value) => value.toLowerCase()))
  if (!used.has(name.toLowerCase())) return name.slice(0, 100)
  for (let index = 2; ; index++) {
    const candidate = `${name.slice(0, 95)} ${index}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}
