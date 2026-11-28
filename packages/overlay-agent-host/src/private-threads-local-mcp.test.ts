import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import type { Tool } from 'ai'
import { LocalMcpServers, localMcpToolName } from './private-threads-local-mcp'
import { localMcpServerSchema, type LocalMcpServer } from './private-threads-protocol'

const fixture = fileURLToPath(new URL('./fixtures/local-mcp-server.mjs', import.meta.url))
const server = (patch: Partial<LocalMcpServer> = {}): LocalMcpServer => ({
  id: 'srv-1', name: 'Fixture', command: process.execPath, args: [fixture], env: { FIXTURE_GREETING: 'Ahoy' }, ...patch,
})
const call = async (definition: Tool | undefined, input: unknown): Promise<string> => {
  const output = await definition!.execute!(input as never, { toolCallId: 'call-1', messages: [] } as never) as { content: Array<{ text: string }> }
  return output.content[0]!.text
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const waitUntil = async (check: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

test('check starts a stdio server with its environment and lists its tools', async () => {
  const pool = new LocalMcpServers()
  try {
    const { tools } = await pool.check(server())
    assert.deepEqual(tools.map(entry => entry.name), ['greet', 'pid'])
    assert.deepEqual(pool.running(), ['srv-1'])
  } finally { await pool.shutdown() }
  assert.deepEqual(pool.running(), [])
})

test('a turn gets server__tool names that ask first, shares the process, and the server stops when idle', async () => {
  const pool = new LocalMcpServers({ idleMs: 100 })
  const stop = new AbortController()
  try {
    const first = await pool.open([server()], { signal: stop.signal, approvalMode: 'ask' })
    assert.deepEqual(Object.keys(first.tools).sort(), ['Fixture__greet', 'Fixture__pid'])
    assert.equal(first.tools.Fixture__greet!.needsApproval, true)
    assert.equal(first.tools.Fixture__greet!.type, 'function')
    assert.match(first.instructions, /Fixture__\*/)
    assert.equal(await call(first.tools.Fixture__greet, { name: 'Ada' }), 'Ahoy, Ada')
    const pid = Number(await call(first.tools.Fixture__pid, {}))

    // A second turn while the first runs reuses the same process; Auto skips approval.
    const second = await pool.open([server()], { signal: stop.signal, approvalMode: 'auto' })
    assert.equal(second.tools.Fixture__greet!.needsApproval, false)
    assert.equal(Number(await call(second.tools.Fixture__pid, {})), pid)
    first.release()
    second.release()
    second.release()
    await waitUntil(() => pool.running().length === 0)
    await waitUntil(() => !alive(pid))
  } finally { await pool.shutdown() }
})

test('a changed server restarts, a removed one stops, and quitting stops the rest', async () => {
  const pool = new LocalMcpServers()
  const signal = new AbortController().signal
  try {
    const before = await pool.open([server()], { signal, approvalMode: 'auto' })
    const oldPid = Number(await call(before.tools.Fixture__pid, {}))
    before.release()
    const after = await pool.open([server({ env: { FIXTURE_GREETING: 'Hi' } })], { signal, approvalMode: 'auto' })
    assert.equal(await call(after.tools.Fixture__greet, { name: 'Bo' }), 'Hi, Bo')
    const newPid = Number(await call(after.tools.Fixture__pid, {}))
    assert.notEqual(newPid, oldPid)
    await waitUntil(() => !alive(oldPid))
    after.release()

    assert.equal(await pool.stop('srv-1'), true)
    await waitUntil(() => !alive(newPid))
    assert.equal(await pool.stop('srv-1'), false)

    const last = await pool.open([server({ id: 'srv-2', name: 'Other' })], { signal, approvalMode: 'auto' })
    const lastPid = Number(await call(last.tools.Other__pid, {}))
    await pool.shutdown()
    await waitUntil(() => !alive(lastPid))
  } finally { await pool.shutdown() }
})

test('a server that fails to start is left out, named for the model, and its environment values stay hidden', async () => {
  const pool = new LocalMcpServers()
  try {
    const turn = await pool.open([
      server({ id: 'bad', name: 'Broken', env: { FIXTURE_FAIL_START: '1', SECRET_TOKEN: 'super-secret-value' } }),
      server({ id: 'missing', name: 'Missing', command: '/no/such/command-overlay-test' }),
      server(),
    ], { signal: new AbortController().signal, approvalMode: 'ask' })
    assert.deepEqual(Object.keys(turn.tools).sort(), ['Fixture__greet', 'Fixture__pid'])
    assert.match(turn.instructions, /could not start for this turn: .*Broken/)
    // Windows words a missing program differently; local MCP servers ship for macOS.
    assert.match(turn.instructions, process.platform === 'win32' ? /Missing \(/ : /Missing \(\/no\/such\/command-overlay-test was not found/)
    assert.doesNotMatch(turn.instructions, /super-secret-value/)
    turn.release()
    assert.deepEqual(pool.running(), ['srv-1'])
    await assert.rejects(pool.check(server({ id: 'bad', env: { FIXTURE_FAIL_START: '1' } })))
  } finally { await pool.shutdown() }
})

test('tool names and server requests are bounded', () => {
  assert.equal(localMcpToolName('My Files!', 'read file'), 'My_Files__read_file')
  assert.ok(localMcpToolName('x'.repeat(80), 'y'.repeat(80)).length <= 64)
  assert.equal(localMcpServerSchema.safeParse(server()).success, true)
  assert.equal(localMcpServerSchema.safeParse(server({ env: { 'BAD NAME': 'x' } })).success, false)
  assert.equal(localMcpServerSchema.safeParse(server({ cwd: 'relative' })).success, false)
  assert.equal(localMcpServerSchema.safeParse({ ...server(), extra: true }).success, false)
})
