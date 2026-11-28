import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalMcpStore } from './local-mcp-servers'

let folder: string
afterEach(() => { if (folder) rmSync(folder, { recursive: true, force: true }) })

function store() {
  folder = mkdtempSync(join(tmpdir(), 'overlay-local-mcp-'))
  const keychain = new Map<string, string>()
  const secrets = { get: (key: string) => keychain.get(key) ?? null, set: (key: string, value: string) => { keychain.set(key, value); return true }, delete: (key: string) => { keychain.delete(key) } }
  const file = join(folder, 'local-mcp-servers.json')
  return { file, keychain, servers: new LocalMcpStore(file, secrets, () => 1_000) }
}

const files = { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], env: { FS_TOKEN: 'fs_secret_value' } }

describe('local MCP servers on this computer', () => {
  it('keeps environment values in the keychain and never in the list or the file', () => {
    const { file, keychain, servers } = store()
    const { id, created } = servers.save({ ...files, importedFrom: { itemId: 'claude_code:mcp_local:filesystem', app: 'Claude Code' } })
    expect(created).toBe(true)
    expect(servers.list()).toEqual([{
      id, name: 'filesystem', command: 'npx', args: files.args, envNames: ['FS_TOKEN'], importedFrom: 'Claude Code', addedAt: 1_000,
    }])
    expect(JSON.stringify(servers.list())).not.toContain('fs_secret_value')
    expect(readFileSync(file, 'utf8')).not.toContain('fs_secret_value')
    expect([...keychain.values()].join()).toContain('fs_secret_value')
    expect(servers.launch(id)).toEqual({ id, name: 'filesystem', command: 'npx', args: files.args, env: { FS_TOKEN: 'fs_secret_value' } })
    expect(servers.importedItemIds()).toEqual(['claude_code:mcp_local:filesystem'])
  })

  it('importing again updates the same server instead of adding a copy', () => {
    const { servers } = store()
    const from = { itemId: 'claude_code:mcp_local:filesystem', app: 'Claude Code' }
    const first = servers.save({ ...files, importedFrom: from })
    const again = servers.save({ ...files, env: { FS_TOKEN: 'rotated' }, importedFrom: from })
    // The same server set up in another app is the same server.
    const cursor = servers.save({ ...files, env: { ROOT: '/tmp' }, importedFrom: { itemId: 'cursor:mcp_local:fs', app: 'Cursor' } })
    expect([again.id, cursor.id]).toEqual([first.id, first.id])
    expect([again.created, cursor.created]).toEqual([false, false])
    expect(servers.list()).toHaveLength(1)
    expect(servers.launch(first.id)!.env).toEqual({ FS_TOKEN: 'rotated', ROOT: '/tmp' })
    // Adding by hand replaces the values.
    servers.save({ ...files, env: {} })
    expect(servers.launch(first.id)!.env).toEqual({})
  })

  it('gives different servers different names, and removing one deletes its values', () => {
    const { keychain, servers } = store()
    const a = servers.save(files)
    const b = servers.save({ ...files, args: ['-y', 'other-server'] })
    expect(servers.list().map((server) => server.name)).toEqual(['filesystem', 'filesystem 2'])
    expect(servers.remove(a.id)).toBe(true)
    expect(servers.remove(a.id)).toBe(false)
    expect(servers.list().map((server) => server.id)).toEqual([b.id])
    expect([...keychain.keys()]).toEqual([`local-mcp-env-${b.id}`])
  })
})
