import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ session: { fromPartition: () => ({ fetch: vi.fn() }) }, app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))
vi.mock('./private-threads-service', () => ({ privateThreadsService: { setKey: vi.fn() } }))
vi.mock('./web-shell', () => ({ getWebShellOrigin: () => 'https://overlay.example', WEB_SHELL_PARTITION: 'test' }))

import { instructionFacts, mcpAuth, parseCodexMcpServers, resolveLocalSetupItem, scanLocalSetup } from './local-setup'
import { importItem, shellKeysFrom, subscriptionSignIns } from './local-setup-service'

let home: string
const write = (path: string, text: string) => { mkdirSync(dirname(join(home, path)), { recursive: true }); writeFileSync(join(home, path), text) }
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }) })

function fixture() {
  home = mkdtempSync(join(tmpdir(), 'overlay-local-setup-'))
  write('.claude/CLAUDE.md', '# About me\n\n- I run operations at a small company\n- Keep updates short and lead with numbers\n\n```sh\nnpm test\n```\n')
  write('.claude/skills/weekly-report/SKILL.md', '---\nname: weekly-report\ndescription: Writes the Friday update\n---\nCollect the week’s numbers and write the update.')
  write('.claude/agents/researcher.md', '---\nname: researcher\ndescription: Finds sources\nmodel: sonnet\n---\nYou research questions and cite sources.')
  write('.claude.json', JSON.stringify({
    oauthAccount: { emailAddress: 'someone@example.com' },
    mcpServers: {
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer lin_secret_token' } },
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    },
  }))
  write('.codex/AGENTS.md', 'Prefer plain language.\n')
  write('.codex/config.toml', '[mcp_servers.notion]\nurl = "https://mcp.notion.com/mcp"\n\n[mcp_servers."local-tool"]\ncommand = "uvx"\n')
  write('.codex/auth.json', JSON.stringify({ tokens: { id_token: 'x' } }))
}

describe('local setup scan', () => {
  it('lists each tool’s items by name, never their contents or tokens', () => {
    fixture()
    const apps = scanLocalSetup(home, 'darwin')
    expect(apps.map((app) => app.id)).toEqual(['claude_code', 'codex'])
    const claude = apps[0]!
    expect(claude.items.map((item) => [item.kind, item.name, item.importable])).toEqual([
      ['instructions', 'Instructions', true],
      ['skill', 'weekly-report', true],
      ['agent', 'researcher', true],
      ['mcp_remote', 'linear', true],
      ['mcp_local', 'filesystem', false],
    ])
    expect(JSON.stringify(apps)).not.toContain('lin_secret_token')
    expect(JSON.stringify(apps)).not.toContain('operations at a small company')
    expect(apps[1]!.items.map((item) => item.kind)).toEqual(['instructions', 'mcp_remote', 'mcp_local'])
    expect(subscriptionSignIns(home)).toEqual({ claude: true, chatgpt: true })
  })

  it('reads an item again with its contents only when it is imported', () => {
    fixture()
    const [claude] = scanLocalSetup(home, 'darwin')
    const ids = Object.fromEntries(claude!.items.map((item) => [item.name, item.id]))
    expect(resolveLocalSetupItem(home, ids.researcher!, 'darwin')).toMatchObject({ kind: 'agent', name: 'researcher', instructions: 'You research questions and cite sources.' })
    expect(resolveLocalSetupItem(home, ids.linear!, 'darwin')).toMatchObject({ kind: 'mcp_remote', server: { url: 'https://mcp.linear.app/mcp' } })
    expect(resolveLocalSetupItem(home, ids.filesystem!, 'darwin')).toBeNull()
    expect(resolveLocalSetupItem(home, 'claude_code:skill:missing', 'darwin')).toBeNull()
  })
})

describe('local setup import', () => {
  it('turns each kind into the matching Overlay resource, once per item', async () => {
    fixture()
    const [claude] = scanLocalSetup(home, 'darwin')
    const posts: Array<{ path: string; key: string; body: Record<string, unknown> }> = []
    const post = async (path: string, _workspaceId: string, key: string, body: unknown) => { posts.push({ path, key, body: body as Record<string, unknown> }) }
    const defaults = { modelId: 'model-1', allowedToolIds: ['save_memory'] }
    for (const item of claude!.items.filter((entry) => entry.importable)) {
      await importItem(resolveLocalSetupItem(home, item.id, 'darwin')!, 'workspace-1', defaults, post)
    }
    expect(posts.map((entry) => entry.path)).toEqual(['/api/v1/memory', '/api/v1/memory', '/api/v1/skills', '/api/v1/agents', '/api/v1/mcps'])
    expect(posts[0]!.body).toMatchObject({ content: 'I run operations at a small company', source: 'manual' })
    expect(posts[3]!.body).toMatchObject({ name: 'researcher', modelId: 'model-1', visibility: 'creator', harness: 'overlay' })
    expect(posts[4]!.body).toMatchObject({ transport: 'streamable-http', authType: 'bearer', authConfig: { bearerToken: 'lin_secret_token' } })
    expect(new Set(posts.map((entry) => entry.key)).size).toBe(posts.length)
    // The same contents get the same key (a retry); changed contents get a new one.
    const again: string[] = []
    const item = resolveLocalSetupItem(home, claude!.items[1]!.id, 'darwin')!
    await importItem(item, 'workspace-1', defaults, async (_p, _w, key) => { again.push(key) })
    await importItem({ ...item, instructions: 'Edited.' } as typeof item, 'workspace-1', defaults, async (_p, _w, key) => { again.push(key) })
    expect(again[0]).toBe(posts[2]!.key)
    expect(again[1]).not.toBe(posts[2]!.key)
  })
})

describe('parsers', () => {
  it('keeps the facts of an instructions file', () => {
    expect(instructionFacts('---\nx: y\n---\n# Title\n- First fact here, long enough\n\nA short paragraph that\nspans two lines.\n```\ncode\n```\n@import ./other.md')).toEqual([
      'First fact here, long enough', 'A short paragraph that spans two lines.',
    ])
  })
  it('reads Codex MCP tables', () => {
    expect(parseCodexMcpServers('[mcp_servers.a]\nurl = "https://a.example"\n[other]\nx = 1\n[mcp_servers."b c"]\ncommand = "run"'))
      .toEqual({ a: { url: 'https://a.example' }, 'b c': { command: 'run' } })
  })
  it('maps headers to MCP auth and leaves out unresolved variables', () => {
    expect(mcpAuth({ Authorization: 'Bearer abc' })).toEqual({ authType: 'bearer', authConfig: { bearerToken: 'abc' } })
    expect(mcpAuth({ 'X-Api-Key': 'k' })).toEqual({ authType: 'header', authConfig: { headerName: 'X-Api-Key', headerValue: 'k' } })
    expect(mcpAuth({ Authorization: 'Bearer ${TOKEN}' })).toEqual({ authType: 'none' })
  })
  it('finds model keys in the shell environment', () => {
    expect(shellKeysFrom({ ANTHROPIC_API_KEY: 'sk-ant-12345678', GOOGLE_API_KEY: 'g-12345678', OPENAI_API_KEY: 'short' }))
      .toEqual([{ provider: 'anthropic', variable: 'ANTHROPIC_API_KEY', value: 'sk-ant-12345678' }, { provider: 'google', variable: 'GOOGLE_API_KEY', value: 'g-12345678' }])
  })
})
