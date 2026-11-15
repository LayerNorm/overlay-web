import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  OVERLAY_AGENT_PROTOCOL_VERSION,
  localToolCallSchema,
  type FilesystemGrant,
  type LocalToolCall,
  type LocalToolRequest,
  type LocalToolResult,
} from '@layernorm/overlay-agent-bridge-protocol'
import { LocalToolExecutor, LocalToolLoop, type LocalToolClient } from './local-tools'
import { jpegSize } from './local-tools-macos'
import { resolveLocalToolPath } from './local-tools-paths'

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'overlay-local-tools-')))
  const root = join(base, 'project')
  const outside = join(base, 'outside')
  await mkdir(root); await mkdir(outside)
  await writeFile(join(outside, 'secret.txt'), 'outside')
  const grant: FilesystemGrant = { mode: 'selected_roots', roots: [root] }
  const executor = new LocalToolExecutor({ stateDirectory: join(base, 'state'), grant: () => grant, platform: 'linux' })
  return { base, root, outside, grant, executor, cleanup: () => rm(base, { recursive: true, force: true }) }
}

function call(request: LocalToolRequest, overrides: Partial<LocalToolCall> = {}): LocalToolCall {
  return localToolCallSchema.parse({
    protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, callId: `call-${Math.random().toString(16).slice(2)}`,
    environmentId: 'env', workspaceId: 'ws', issuedAt: Date.now(), deadlineAt: Date.now() + 60_000, request, ...overrides,
  })
}

test('paths resolve against the first root and cannot leave the approved folders, including through a symlink', async () => {
  const f = await fixture()
  try {
    assert.equal(await resolveLocalToolPath(f.grant, 'notes.md', 'write'), join(f.root, 'notes.md'))
    assert.equal(await resolveLocalToolPath(f.grant, 'new/dir/file.txt', 'write'), join(f.root, 'new/dir/file.txt'))
    await assert.rejects(resolveLocalToolPath(f.grant, join(f.outside, 'secret.txt'), 'read'), /outside the folders/)
    await assert.rejects(resolveLocalToolPath(f.grant, '../outside/secret.txt', 'read'), /outside the folders/)
    await symlink(f.outside, join(f.root, 'escape'))
    await assert.rejects(resolveLocalToolPath(f.grant, 'escape/secret.txt', 'read'), /outside the folders/)
    await assert.rejects(resolveLocalToolPath(f.grant, 'escape/new.txt', 'write'), /outside the folders/)
    const all = await resolveLocalToolPath({ mode: 'all_user_files' }, join(f.outside, 'secret.txt'), 'read')
    assert.equal(all, join(f.outside, 'secret.txt'))
  } finally { await f.cleanup() }
})

test('exec runs in an approved folder with output, exit code and timeout', async () => {
  const f = await fixture()
  try {
    const ok = await f.executor.execute(call({ kind: 'exec', command: 'pwd; echo err >&2; exit 3', timeoutMs: 10_000 }))
    assert.equal(ok.ok, true)
    if (!ok.ok) return
    assert.equal(String(ok.result.stdout).trim(), f.root)
    assert.equal(String(ok.result.stderr).trim(), 'err')
    assert.equal(ok.result.exitCode, 3)
    const slow = await f.executor.execute(call({ kind: 'exec', command: 'sleep 5', timeoutMs: 1_000 }))
    assert.equal(slow.ok, true)
    if (slow.ok) assert.match(String(slow.result.stderr), /timed out/)
    const denied = await f.executor.execute(call({ kind: 'exec', command: 'pwd', cwd: f.outside, timeoutMs: 5_000 }))
    assert.deepEqual(denied.ok ? null : denied.error.code, 'outside_approved_folders')
  } finally { await f.cleanup() }
})

test('files are written atomically, read back with limits and listed', async () => {
  const f = await fixture()
  try {
    const written = await f.executor.execute(call({ kind: 'write_file', path: 'src/a.txt', contentsBase64: Buffer.from('hello world').toString('base64') }))
    assert.equal(written.ok, true)
    assert.equal(await readFile(join(f.root, 'src/a.txt'), 'utf8'), 'hello world')
    const read = await f.executor.execute(call({ kind: 'read_file', path: 'src/a.txt', maxBytes: 5 }))
    assert.deepEqual(read.ok && read.result, { found: true, contentsBase64: Buffer.from('hello').toString('base64'), bytes: 11, truncated: true })
    const missing = await f.executor.execute(call({ kind: 'read_file', path: 'src/none.txt', maxBytes: 5 }))
    assert.deepEqual(missing.ok && missing.result, { found: false })
    const listed = await f.executor.execute(call({ kind: 'list_files', path: 'src' }))
    assert.deepEqual(listed.ok && listed.result, { entries: [{ path: join(f.root, 'src/a.txt'), kind: 'file', size: 11 }] })
    const outside = await f.executor.execute(call({ kind: 'read_file', path: join(f.outside, 'secret.txt'), maxBytes: 100 }))
    assert.equal(outside.ok ? '' : outside.error.code, 'outside_approved_folders')
  } finally { await f.cleanup() }
})

test('terminal sessions start, stream output, list and cancel like the cloud driver', async () => {
  const f = await fixture()
  try {
    const started = await f.executor.execute(call({ kind: 'driver', command: 'terminal_start', args: { command: 'echo one; sleep 30' } }))
    assert.equal(started.ok, true)
    if (!started.ok) return
    const id = String(started.result.id)
    assert.match(id, /^t-[0-9a-f]{12}$/)
    let output = ''
    for (let attempt = 0; attempt < 40 && !output.includes('one'); attempt++) {
      const read = await f.executor.execute(call({ kind: 'driver', command: 'terminal_read', args: { id } }))
      if (read.ok) output = String(read.result.output)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.match(output, /one/)
    const listed = await f.executor.execute(call({ kind: 'driver', command: 'terminal_list', args: {} }))
    assert.equal(listed.ok && (listed.result.sessions as Array<{ running: boolean }>)[0]?.running, true)
    const cancelled = await f.executor.execute(call({ kind: 'driver', command: 'terminal_cancel', args: { id } }))
    assert.equal(cancelled.ok && cancelled.result.running, false)
    assert.ok(cancelled.ok && typeof cancelled.result.exitCode === 'number')
    const done = await f.executor.execute(call({ kind: 'driver', command: 'terminal_start', args: { command: 'exit 4' } }))
    assert.equal(done.ok, true)
    if (!done.ok) return
    let exitCode: unknown = null
    for (let attempt = 0; attempt < 40 && exitCode === null; attempt++) {
      const read = await f.executor.execute(call({ kind: 'driver', command: 'terminal_read', args: { id: done.result.id } }))
      if (read.ok) exitCode = read.result.exitCode
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(exitCode, 4)
    const invalid = await f.executor.execute(call({ kind: 'driver', command: 'terminal_read', args: { id: '../etc' } }))
    assert.equal(invalid.ok ? '' : invalid.error.code, 'invalid_input')
  } finally { await f.executor.shutdown(); await f.cleanup() }
})

test('screen control reports unsupported off macOS instead of guessing', async () => {
  const f = await fixture()
  try {
    const shot = await f.executor.execute(call({ kind: 'driver', command: 'screenshot', args: {} }))
    assert.equal(shot.ok ? '' : shot.error.code, 'desktop_unsupported')
    const capability = await f.executor.capability()
    assert.deepEqual(capability.features.filter((feature) => feature !== 'browser'), ['exec', 'files', 'terminal'])
    assert.equal(capability.os, 'linux')
  } finally { await f.cleanup() }
})

test('the loop runs each call once, reports expired calls without running them and posts results', async () => {
  const f = await fixture()
  try {
    const marker = join(f.root, 'ran.txt')
    const results: LocalToolResult[] = []
    const queue: LocalToolCall[][] = [[
      call({ kind: 'exec', command: `echo ran >> ${marker}`, timeoutMs: 5_000 }, { callId: 'fresh' }),
      call({ kind: 'exec', command: `echo late >> ${marker}`, timeoutMs: 5_000 }, { callId: 'late', deadlineAt: Date.now() - 1 }),
    ]]
    const controller = new AbortController()
    const client: LocalToolClient = {
      async pollLocalToolCalls({ signal }) {
        const next = queue.shift()
        if (next) return { calls: next }
        await new Promise((resolve) => setTimeout(resolve, 20))
        if (signal?.aborted) throw new Error('aborted')
        return { calls: [] }
      },
      async submitLocalToolResult(result) {
        results.push(result)
        if (results.length === 2) controller.abort()
      },
    }
    await new LocalToolLoop(client, f.executor).run(controller.signal)
    const byId = new Map(results.map((result) => [result.callId, result.outcome]))
    assert.equal(byId.get('fresh')?.ok, true)
    assert.deepEqual(byId.get('late'), { ok: false, error: { code: 'expired', message: 'The tool call expired before this Mac received it.' } })
    assert.equal(await readFile(marker, 'utf8'), 'ran\n')
  } finally { await f.cleanup() }
})

test('JPEG frame size is read from the header', () => {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x3f, 0x05, 0x00, 0x03])
  assert.deepEqual(jpegSize(header), { width: 1280, height: 831 })
})
