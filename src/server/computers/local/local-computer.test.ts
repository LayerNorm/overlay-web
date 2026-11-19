import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { LocalToolCall, LocalToolOutcome, LocalToolRequest } from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentEnvironment } from '@overlay/workspace-contracts'
import type { SandboxInstance } from '@overlay/sandbox-runtime'
import { LocalToolExecutor, LocalToolLoop } from '../../../../packages/overlay-agent-host/src/local-tools'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ComputerServiceError } from '@/server/computers/ComputerService'
import { runComputerDriverCommand } from '@/server/computers/ComputerDesktopDriver'
import { executeComputerDownloadFile, executeComputerExec, executeComputerListFiles, executeComputerReadFile, executeComputerTerminal, executeComputerWriteFile } from '@/server/tools/tools/overlay-executes'
import { LocalComputerError, LocalComputerService, type LocalToolCallRepository } from './LocalComputerService'
import { LocalHostSandboxInstance } from './LocalHostSandboxInstance'

/** Same rules as convex/agents/localToolCalls.ts, in memory. */
class MemoryRepository implements LocalToolCallRepository {
  calls = new Map<string, { workspaceId: string; environmentId: string; request: LocalToolRequest; status: string; deadlineAt: number; createdAt: number; outcome?: LocalToolOutcome }>()
  async enqueue(input: Parameters<LocalToolCallRepository['enqueue']>[0]) {
    this.calls.set(input.callId, { workspaceId: input.workspaceId, environmentId: input.environmentId, request: input.request, status: 'pending', deadlineAt: input.deadlineAt, createdAt: input.now })
  }
  async claim(input: Parameters<LocalToolCallRepository['claim']>[0]) {
    const claimed: Array<Omit<LocalToolCall, 'protocolVersion'>> = []
    for (const [callId, call] of this.calls) {
      if (call.status !== 'pending' || call.environmentId !== input.environmentId) continue
      if (call.deadlineAt <= input.now) { call.status = 'expired'; continue }
      call.status = 'claimed'
      claimed.push({ callId, workspaceId: call.workspaceId, environmentId: call.environmentId, issuedAt: call.createdAt, deadlineAt: call.deadlineAt, request: call.request })
    }
    return claimed
  }
  async complete(input: Parameters<LocalToolCallRepository['complete']>[0]) {
    const call = this.calls.get(input.callId)
    if (!call || call.status !== 'claimed') return { accepted: call?.status === 'completed' }
    call.status = 'completed'; call.outcome = input.outcome
    return { accepted: true }
  }
  async get(input: Parameters<LocalToolCallRepository['get']>[0]) {
    const call = this.calls.get(input.callId)
    return call ? { status: call.status, ...(call.outcome ? { outcome: call.outcome } : {}) } : null
  }
  async expire(input: Parameters<LocalToolCallRepository['expire']>[0]) {
    const call = this.calls.get(input.callId)
    if (!call) return null
    if (call.status === 'pending' || call.status === 'claimed') call.status = 'expired'
    return { status: call.status, ...(call.outcome ? { outcome: call.outcome } : {}) }
  }
}

function macEnvironment(overrides: Partial<AgentEnvironment> = {}): AgentEnvironment {
  return {
    id: 'env-mac', workspaceId: 'ws-1', kind: 'local', name: 'Dev MacBook', status: 'online', approvedByUserId: 'user-1',
    approvedAt: 1, lastSeenAt: Date.now(), createdAt: 1, updatedAt: 1,
    capabilities: { localTools: { version: 1, os: 'linux', features: ['exec', 'files', 'terminal'], homeDirectory: '/home/dev' } },
    ...overrides,
  }
}

/** A real host executor answering through the same service methods the host routes call. */
async function connectedMac(environments: AgentEnvironment[] = [macEnvironment()]) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'overlay-local-computer-')))
  const root = join(base, 'project')
  await mkdir(root)
  const repository = new MemoryRepository()
  const service = new LocalComputerService({ repository, listEnvironments: async () => environments, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10))) })
  const executor = new LocalToolExecutor({ stateDirectory: join(base, 'state'), grant: () => ({ mode: 'selected_roots', roots: [root] }), platform: 'linux' })
  const controller = new AbortController()
  const loop = new LocalToolLoop({
    pollLocalToolCalls: async ({ waitMs }) => ({ calls: await service.pollForHost({ workspaceId: 'ws-1', environmentId: 'env-mac', waitMs: Math.min(waitMs, 200), signal: controller.signal }) }),
    submitLocalToolResult: async (result) => { await service.submitFromHost({ workspaceId: 'ws-1', environmentId: 'env-mac', body: result }) },
  }, executor).run(controller.signal)
  return {
    root, service, repository,
    async close() { controller.abort(); await loop; await rm(base, { recursive: true, force: true }) },
  }
}

test('a Computer tool call reaches the Mac through the host channel and comes back', async () => {
  const mac = await connectedMac()
  try {
    const computer = await mac.service.findForUser({ workspaceId: 'ws-1', userId: 'user-1' })
    assert.ok(computer)
    const instance = new LocalHostSandboxInstance(computer, mac.service, { userId: 'user-1', toolName: 'computer_exec' })
    const run = await (await instance.runCommand({ command: 'echo hello from the mac && pwd', timeoutMs: 10_000 })).wait()
    assert.equal(run.exitCode, 0)
    assert.equal(run.stdout, `hello from the mac\n${mac.root}\n`)
    await instance.writeFiles([{ path: 'notes/plan.md', contents: new TextEncoder().encode('# Plan\n') }])
    assert.equal(await readFile(join(mac.root, 'notes/plan.md'), 'utf8'), '# Plan\n')
    assert.equal(new TextDecoder().decode((await instance.readFile('notes/plan.md'))!), '# Plan\n')
    assert.equal(await instance.readFile('notes/missing.md'), null)
    assert.deepEqual((await instance.listFiles('notes')).map((entry) => entry.kind), ['file'])
    const started = await runComputerDriverCommand(instance, 'terminal_start', { command: 'echo terminal-ok' }, { requireDesktop: false })
    let output = ''
    for (let attempt = 0; attempt < 50 && !output.includes('terminal-ok'); attempt++) {
      output = String((await runComputerDriverCommand(instance, 'terminal_read', { id: started.id }, { requireDesktop: false })).output)
    }
    assert.match(output, /terminal-ok/)
    await assert.rejects(instance.readFile('/etc/hosts'), (error: unknown) => error instanceof LocalComputerError && error.code === 'outside_approved_folders')
    assert.ok([...mac.repository.calls.values()].every((call) => call.status === 'completed'))
  } finally { await mac.close() }
})

test('computer_download_file writes under the first approved folder instead of the Mac home directory', async () => {
  const mac = await connectedMac()
  try {
    const computer = await mac.service.findForUser({ workspaceId: 'ws-1', userId: 'user-1' })
    assert.ok(computer)
    const instance = new LocalHostSandboxInstance(computer, mac.service, { userId: 'user-1', toolName: 'computer_download_file' })
    const bytes = new Uint8Array([0, 255, 12, 128])
    const result = await executeComputerDownloadFile({
      userId: 'user-1',
      workspaceId: 'ws-1',
      allowedToolIds: ['computer_download_file', 'read_file'],
      computerApprovalContext: 'work',
    }, { fileId: 'file-1', target: 'local' }, {
      files: {
        async getOrListFiles() {
          return { type: 'file', name: 'transfer.bin', sizeBytes: bytes.byteLength, workspaceId: 'ws-1', scope: 'personal', isStorageBacked: true }
        },
        async readFileBytes() { return bytes },
      } as never,
      resolveComputer: async () => ({
        ok: true,
        computer: { id: 'local:env-mac', name: 'Dev MacBook', controlledByUserId: undefined, location: 'local' },
        async operate(operation: (instance: SandboxInstance, current: { controlledByUserId: undefined }) => Promise<unknown>) {
          return operation(instance, { controlledByUserId: undefined })
        },
      }) as never,
    })

    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.path.startsWith(`${mac.root}/.overlay-download.`))
    assert.notEqual(result.path, '/home/dev')
    assert.deepEqual(await readFile(result.path), Buffer.from(bytes))
    assert.ok([...mac.repository.calls.values()].every((call) => call.status === 'completed'))
  } finally { await mac.close() }
})

test('only the approving user, an online machine and a local-tools host count as the user\'s Mac', async () => {
  const service = (environments: AgentEnvironment[]) => new LocalComputerService({ repository: new MemoryRepository(), listEnvironments: async () => environments })
  assert.equal(await service([macEnvironment({ approvedByUserId: 'someone-else' })]).findForUser({ workspaceId: 'ws-1', userId: 'user-1' }), null)
  assert.equal(await service([macEnvironment({ lastSeenAt: Date.now() - 10 * 60_000 })]).findForUser({ workspaceId: 'ws-1', userId: 'user-1' }), null)
  assert.equal(await service([macEnvironment({ capabilities: {} })]).findForUser({ workspaceId: 'ws-1', userId: 'user-1' }), null)
  assert.equal(await service([macEnvironment({ kind: 'vps' })]).findForUser({ workspaceId: 'ws-1', userId: 'user-1' }), null)
  assert.equal(await service([macEnvironment({ status: 'revoked', revokedAt: 2 })]).findForUser({ workspaceId: 'ws-1', userId: 'user-1' }), null)
  assert.equal((await service([macEnvironment()]).findForUser({ workspaceId: 'ws-1', userId: 'user-1' }))?.name, 'Dev MacBook')
})

test('a Mac that never answers fails the call with a clear message and expires it', async () => {
  let clock = 0
  const repository = new MemoryRepository()
  const service = new LocalComputerService({ repository, listEnvironments: async () => [macEnvironment({ lastSeenAt: 0 })], now: () => clock, sleep: async (ms) => { clock += ms } })
  const computer = await service.findForUser({ workspaceId: 'ws-1', userId: 'user-1', includeOffline: true })
  await assert.rejects(service.execute({ computer: computer!, userId: 'user-1', toolName: 'computer_exec', request: { kind: 'exec', command: 'ls', timeoutMs: 5_000 }, actionTimeoutMs: 5_000 }),
    (error: unknown) => error instanceof LocalComputerError && error.code === 'local_computer_unreachable' && /did not answer/.test(error.message))
  assert.equal([...repository.calls.values()][0]?.status, 'expired')
})

function serverContext() {
  const previous = process.env.NEXT_PHASE
  process.env.NEXT_PHASE = 'phase-production-build'
  try { return getOverlayServerContext() } finally {
    if (previous === undefined) delete process.env.NEXT_PHASE
    else process.env.NEXT_PHASE = previous
  }
}

test('computer tools fall back to the user\'s Mac without a cloud Computer, honor an explicit target and keep automations off the Mac', async () => {
  const mac = await connectedMac()
  const context = serverContext()
  const original = { computerService: context.computerService, workspaceService: context.workspaceService, localComputerService: context.localComputerService }
  let cloudLookups = 0
  context.workspaceService = { ...original.workspaceService, listForUser: async () => [{ workspace: { id: 'ws-1' }, principal: { id: 'p-1' }, membership: { role: 'member' } }] } as unknown as typeof context.workspaceService
  context.computerService = { ...original.computerService, getForOwner: async () => { cloudLookups++; throw new ComputerServiceError('not_found', 'Computer not found', 404) } } as unknown as typeof context.computerService
  context.localComputerService = mac.service
  const options = { userId: 'user-1', workspaceId: 'ws-1', computerApprovalContext: 'work' as const }
  try {
    const written = await executeComputerWriteFile(options, { path: 'hello.txt', contents: 'one\ntwo\n' })
    assert.deepEqual({ ...written, path: undefined }, { success: true, path: undefined, bytes: 8, created: true, linesAdded: 2, linesRemoved: 0, computerId: 'local:env-mac' })
    const exec = await executeComputerExec(options, { command: 'cat hello.txt' })
    assert.equal(exec.success, true)
    assert.equal((exec as { stdout: string }).stdout, 'one\ntwo\n')
    assert.equal((exec as { computerName?: string }).computerName, 'Dev MacBook')
    const listed = await executeComputerListFiles(options, { path: mac.root, target: 'local' })
    assert.equal(listed.success, true)
    assert.equal(cloudLookups, 2, 'an explicit local target skips the cloud lookup')
    const read = await executeComputerReadFile(options, { path: 'hello.txt', target: 'local' })
    assert.equal((read as { contents?: string }).contents, 'one\ntwo\n')
    const terminal = await executeComputerTerminal(options, { action: 'list', target: 'local' })
    assert.equal(terminal.success, true)
    const cloudOnly = await executeComputerExec(options, { command: 'ls', target: 'cloud' })
    assert.equal(cloudOnly.success, false)
    const automation = await executeComputerExec({ ...options, computerApprovalContext: 'automation' }, { command: 'ls', target: 'local' })
    assert.deepEqual(automation, { success: false, error: "Automations cannot use the user's computer. Use the cloud Computer instead." })
    const other = await executeComputerExec({ ...options, userId: 'someone-else' }, { command: 'ls', target: 'local' })
    assert.equal(other.success, false)
    assert.match(String((other as { error: string }).error), /not connected/)
  } finally {
    Object.assign(context, original)
    await mac.close()
  }
})
