import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalSetupApp, LocalSetupItem, LocalSetupItemKind } from '../../../packages/overlay-desktop-bridge/src/index'

/**
 * Finds what other AI tools keep on this computer (internal/plans/DESKTOP_ONBOARDING_PLAN.md in overlay-web):
 * instructions, skills, subagents and MCP servers of Claude Code, Codex, Claude Desktop, Cursor and Gemini CLI.
 * It only reads known files and never changes them. `scanLocalSetup` returns names and counts for the page;
 * `resolveLocalSetupItem` reads one item's contents again when the person imports it.
 */

const MAX_FILE_BYTES = 256 * 1024
const MAX_ITEMS_PER_KIND = 50

export type McpServerEntry = {
  name: string
  url?: string
  command?: string
  transport: 'sse' | 'streamable-http'
  headers: Record<string, string>
}

export type ResolvedLocalSetupItem =
  | { id: string; kind: 'instructions'; name: string; content: string }
  | { id: string; kind: 'skill'; name: string; description: string; instructions: string }
  | { id: string; kind: 'agent'; name: string; description: string; instructions: string }
  | { id: string; kind: 'mcp_remote'; name: string; server: McpServerEntry }

type Source = {
  app: LocalSetupApp['id']
  name: string
  location: string
  instructions?: string
  skillsDir?: string
  agentsDir?: string
  mcp?: { file: string; format: 'json' | 'toml'; key: string }
}

function sources(home: string, platform: NodeJS.Platform): Source[] {
  const claudeDesktop = platform === 'darwin'
    ? join(home, 'Library/Application Support/Claude/claude_desktop_config.json')
    : platform === 'win32'
      ? join(process.env.APPDATA ?? join(home, 'AppData/Roaming'), 'Claude/claude_desktop_config.json')
      : join(home, '.config/Claude/claude_desktop_config.json')
  return [
    {
      app: 'claude_code', name: 'Claude Code', location: '~/.claude',
      instructions: join(home, '.claude/CLAUDE.md'), skillsDir: join(home, '.claude/skills'), agentsDir: join(home, '.claude/agents'),
      mcp: { file: join(home, '.claude.json'), format: 'json', key: 'mcpServers' },
    },
    {
      app: 'codex', name: 'Codex', location: '~/.codex',
      instructions: join(home, '.codex/AGENTS.md'), skillsDir: join(home, '.codex/skills'),
      mcp: { file: join(home, '.codex/config.toml'), format: 'toml', key: 'mcp_servers' },
    },
    {
      app: 'claude_desktop', name: 'Claude Desktop', location: claudeDesktop.replace(home, '~'),
      mcp: { file: claudeDesktop, format: 'json', key: 'mcpServers' },
    },
    { app: 'cursor', name: 'Cursor', location: '~/.cursor', mcp: { file: join(home, '.cursor/mcp.json'), format: 'json', key: 'mcpServers' } },
    {
      app: 'gemini_cli', name: 'Gemini CLI', location: '~/.gemini',
      instructions: join(home, '.gemini/GEMINI.md'),
      mcp: { file: join(home, '.gemini/settings.json'), format: 'json', key: 'mcpServers' },
    },
  ]
}

function readText(path: string): string | null {
  try {
    if (!existsSync(path) || statSync(path).size > MAX_FILE_BYTES) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const itemId = (app: string, kind: LocalSetupItemKind, name: string) =>
  `${app}:${kind}:${name}`.replace(/[^\w:.@-]+/g, '-').slice(0, 200)

/** `---` front matter of a SKILL.md or subagent file: simple `key: value` lines only. */
export function parseFrontMatter(text: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { fields: {}, body: text.trim() }
  const fields: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line)
    if (pair) fields[pair[1]!.toLowerCase()] = pair[2]!.trim().replace(/^["']|["']$/g, '')
  }
  return { fields, body: match[2]!.trim() }
}

/** The `[mcp_servers.<name>]` tables of a Codex config.toml; only the keys Overlay needs. */
export function parseCodexMcpServers(text: string): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {}
  let current: Record<string, unknown> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const table = /^\[mcp_servers\.("?)([^\]"]+)\1\]$/.exec(line)
    if (table) { current = servers[table[2]!] = {}; continue }
    if (line.startsWith('[')) { current = null; continue }
    const pair = /^([\w-]+)\s*=\s*(.+)$/.exec(line)
    if (current && pair) {
      const value = pair[2]!.trim()
      current[pair[1]!] = /^".*"$/.test(value) ? value.slice(1, -1) : value
    }
  }
  return servers
}

function mcpEntries(source: Source): McpServerEntry[] {
  if (!source.mcp) return []
  const text = readText(source.mcp.file)
  if (!text) return []
  let table: Record<string, unknown> = {}
  try {
    table = source.mcp.format === 'toml'
      ? parseCodexMcpServers(text)
      : ((JSON.parse(text) as Record<string, unknown>)[source.mcp.key] as Record<string, unknown>) ?? {}
  } catch {
    return []
  }
  if (!table || typeof table !== 'object') return []
  return Object.entries(table).slice(0, MAX_ITEMS_PER_KIND).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object') return []
    const entry = value as Record<string, unknown>
    const url = typeof entry.httpUrl === 'string' ? entry.httpUrl : typeof entry.url === 'string' ? entry.url : undefined
    const command = typeof entry.command === 'string' ? entry.command : undefined
    if (!url && !command) return []
    const headers = entry.headers && typeof entry.headers === 'object' && !Array.isArray(entry.headers)
      ? Object.fromEntries(Object.entries(entry.headers as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      : {}
    const transport = entry.type === 'sse' || (typeof entry.url === 'string' && typeof entry.httpUrl !== 'string' && source.app === 'gemini_cli')
      ? 'sse' as const : 'streamable-http' as const
    return [{ name, url, command, transport, headers }]
  })
}

function markdownFiles(dir: string | undefined, nested: boolean): string[] {
  if (!dir || !existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => nested
        ? entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')) ? [join(dir, entry.name, 'SKILL.md')] : []
        : entry.isFile() && entry.name.endsWith('.md') ? [join(dir, entry.name)] : [])
      .sort()
      .slice(0, MAX_ITEMS_PER_KIND)
  } catch {
    return []
  }
}

function skillOrAgent(path: string, kind: 'skill' | 'agent'): { name: string; description: string; instructions: string } | null {
  const text = readText(path)
  if (!text) return null
  const { fields, body } = parseFrontMatter(text)
  const fallback = kind === 'skill' ? path.split(/[\\/]/).at(-2)! : path.split(/[\\/]/).at(-1)!.replace(/\.md$/, '')
  const name = (fields.name || fallback).slice(0, 80)
  const description = (fields.description || body.split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, '') || name).slice(0, 500)
  return body ? { name, description, instructions: body.slice(0, 50_000) } : null
}

function lineCount(text: string) {
  return text.split(/\r?\n/).filter((line) => line.trim()).length
}

export function scanLocalSetup(home: string, platform: NodeJS.Platform = process.platform): LocalSetupApp[] {
  return sources(home, platform).flatMap((source) => {
    const items: LocalSetupItem[] = []
    const instructions = source.instructions ? readText(source.instructions) : null
    if (instructions?.trim()) {
      const file = source.instructions!.split(/[\\/]/).at(-1)!
      items.push({ id: itemId(source.app, 'instructions', file), kind: 'instructions', name: 'Instructions', detail: `${file} · ${lineCount(instructions)} lines`, importable: true })
    }
    for (const path of markdownFiles(source.skillsDir, true)) {
      const skill = skillOrAgent(path, 'skill')
      if (skill) items.push({ id: itemId(source.app, 'skill', skill.name), kind: 'skill', name: skill.name, detail: skill.description, importable: true })
    }
    for (const path of markdownFiles(source.agentsDir, false)) {
      const agent = skillOrAgent(path, 'agent')
      if (agent) items.push({ id: itemId(source.app, 'agent', agent.name), kind: 'agent', name: agent.name, detail: agent.description, importable: true })
    }
    for (const server of mcpEntries(source)) {
      if (server.url) {
        let host = server.url
        try { host = new URL(server.url).host } catch { /* shown as written */ }
        const auth = Object.keys(server.headers).length ? ' · with a header token' : ''
        items.push({ id: itemId(source.app, 'mcp_remote', server.name), kind: 'mcp_remote', name: server.name, detail: `MCP server · ${host}${auth}`, importable: /^https:\/\//.test(server.url) })
      } else {
        items.push({ id: itemId(source.app, 'mcp_local', server.name), kind: 'mcp_local', name: server.name, detail: 'MCP server · runs a command on this computer', importable: false })
      }
    }
    return items.length ? [{ id: source.app, name: source.name, location: source.location, items }] : []
  })
}

/** Reads one scanned item again, with its contents, for importing. Null when it is gone or can't be imported. */
export function resolveLocalSetupItem(home: string, id: string, platform: NodeJS.Platform = process.platform): ResolvedLocalSetupItem | null {
  for (const source of sources(home, platform)) {
    if (!id.startsWith(`${source.app}:`)) continue
    const instructions = source.instructions ? readText(source.instructions) : null
    if (instructions?.trim() && id === itemId(source.app, 'instructions', source.instructions!.split(/[\\/]/).at(-1)!)) {
      return { id, kind: 'instructions', name: `${source.name} instructions`, content: instructions }
    }
    for (const [kind, paths] of [['skill', markdownFiles(source.skillsDir, true)], ['agent', markdownFiles(source.agentsDir, false)]] as const) {
      for (const path of paths) {
        const found = skillOrAgent(path, kind)
        if (found && id === itemId(source.app, kind, found.name)) return { id, kind, ...found }
      }
    }
    for (const server of mcpEntries(source)) {
      if (server.url && /^https:\/\//.test(server.url) && id === itemId(source.app, 'mcp_remote', server.name)) {
        return { id, kind: 'mcp_remote', name: server.name, server }
      }
    }
  }
  return null
}

/**
 * The facts in an instructions file: list items and short paragraphs, without headings, code or front matter.
 * Each becomes one memory, so it can be found, edited or removed on its own.
 */
export function instructionFacts(markdown: string, limit = 40): string[] {
  const facts: string[] = []
  let inCode = false
  let paragraph: string[] = []
  const flush = () => {
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim()
    paragraph = []
    if (text.length >= 12) facts.push(text.slice(0, 600))
  }
  for (const raw of parseFrontMatter(markdown).body.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('```')) { inCode = !inCode; flush(); continue }
    if (inCode) continue
    if (!line || /^#{1,6}\s/.test(line) || /^(-{3,}|\*{3,})$/.test(line) || line.startsWith('@')) { flush(); continue }
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) { flush(); paragraph = [item[1]!]; flush(); continue }
    paragraph.push(line)
  }
  flush()
  return [...new Set(facts.map((fact) => fact.replace(/\*\*|__|`/g, '')))].slice(0, limit)
}

/** How a remote server's headers become Overlay's MCP authentication. Unresolved `${VAR}` values are left out. */
export function mcpAuth(headers: Record<string, string>):
  | { authType: 'none' }
  | { authType: 'bearer'; authConfig: { bearerToken: string } }
  | { authType: 'header'; authConfig: { headerName: string; headerValue: string } } {
  const usable = Object.entries(headers).filter(([, value]) => value.trim() && !/\$\{?[A-Z_][A-Z0-9_]*\}?/.test(value))
  const authorization = usable.find(([name]) => name.toLowerCase() === 'authorization')
  const bearer = authorization && /^Bearer\s+(.+)$/i.exec(authorization[1])
  if (bearer) return { authType: 'bearer', authConfig: { bearerToken: bearer[1]!.trim() } }
  const [header] = usable
  return header ? { authType: 'header', authConfig: { headerName: header[0], headerValue: header[1] } } : { authType: 'none' }
}
