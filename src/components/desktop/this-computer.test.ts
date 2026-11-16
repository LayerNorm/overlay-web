import assert from 'node:assert/strict'
import test from 'node:test'
import type { LocalComputerStatus } from '@overlay/desktop-bridge'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import {
  approvedRoots, chooseThisComputerFolder, chosenFolders, connectThisComputer, ensureThisComputer, folderName,
  removeThisComputerFolder, type ThisComputerDeps,
} from './this-computer'

const WORK = '/Users/sam/Overlay Files'

function environment(overrides: Partial<AgentEnvironmentResource> = {}): AgentEnvironmentResource {
  return {
    id: 'env-1', workspaceId: 'ws', kind: 'local', name: 'Sam’s MacBook Pro', status: 'online',
    filesystemGrant: { mode: 'selected_roots', roots: [WORK] }, ...overrides,
  } as AgentEnvironmentResource
}

/** A desktop app and server in memory: the host prints its phrase one status check after it starts. */
function world(initial: { environmentId?: string | null; environments?: AgentEnvironmentResource[]; picked?: string | null; hostState?: string } = {}) {
  const calls: string[] = []
  let environments = initial.environments ?? []
  let started = 0
  let hostState = initial.hostState ?? 'idle'
  let environmentId = initial.environmentId ?? null
  const status = (): LocalComputerStatus => ({
    hostState, localTools: hostState === 'running', keepAvailable: hostState === 'running', homeDirectory: '/Users/sam',
    verificationPhrase: started > 0 ? 'calm-river-stone' : null, computerName: 'Sam’s MacBook Pro', environmentId, workFolder: WORK,
    permissions: { accessibility: false, screenRecording: false },
  })
  const deps: ThisComputerDeps = {
    workspaceId: 'ws',
    wait: async () => {},
    call: (async (method: string, input: unknown) => {
      calls.push(method)
      if (method === 'localComputer.status') return status()
      if (method === 'agentHost.start') {
        started += 1
        hostState = 'running'
        environments = [...environments, environment({ id: 'env-new', status: 'pending', verificationPhrase: 'calm-river-stone', filesystemGrant: undefined })]
        return { state: 'running', pid: 1, logTail: [] }
      }
      if (method === 'localComputer.setKeepAvailable') { hostState = (input as { enabled: boolean }).enabled ? 'running' : 'idle'; return status() }
      if (method === 'localComputer.chooseFolder') return initial.picked ? { path: initial.picked } : null
      throw new Error(`unexpected ${method}`)
    }) as ThisComputerDeps['call'],
    api: {
      list: async () => ({ environments }),
      createEnrollment: async () => ({ enrollmentSessionId: 's', code: 'code-123456', command: '', expiresAt: 0 }),
      approve: async (_workspaceId, id, filesystemGrant) => {
        environments = environments.map((entry) => entry.id === id ? { ...entry, status: 'online', filesystemGrant } as AgentEnvironmentResource : entry)
        environmentId = id
        return { environment: environments.find((entry) => entry.id === id)! }
      },
      updateRoots: async (_workspaceId, id, filesystemGrant) => {
        environments = environments.map((entry) => entry.id === id ? { ...entry, filesystemGrant } as AgentEnvironmentResource : entry)
        return { environment: environments.find((entry) => entry.id === id)! }
      },
    },
  }
  return { deps, calls, roots: () => approvedRoots(environments.find((entry) => entry.status !== 'pending')) }
}

test('connecting approves only the enrollment whose phrase this app’s host printed, for the work folder', async () => {
  const other = environment({ id: 'env-other', status: 'pending', verificationPhrase: 'someone-elses-phrase', filesystemGrant: undefined })
  const w = world({ environments: [other] })
  const connected = await connectThisComputer(w.deps)
  assert.equal(connected.id, 'env-new')
  assert.deepEqual(approvedRoots(connected), [WORK])
  assert.ok(w.calls.includes('localComputer.setKeepAvailable'))
})

test('connecting gives up with a readable error when the host fails or never appears', async () => {
  const failed = world({ hostState: 'idle' })
  failed.deps.call = (async (method: string) => {
    if (method === 'localComputer.status') return { hostState: 'error', verificationPhrase: null, workFolder: WORK } as LocalComputerStatus
    return { state: 'error', pid: null, logTail: [] }
  }) as ThisComputerDeps['call']
  await assert.rejects(connectThisComputer(failed.deps), /couldn’t start on this computer/)
  const silent = world()
  let clock = 0
  silent.deps.now = () => (clock += 60_000)
  silent.deps.api.list = async () => ({ environments: [] })
  await assert.rejects(connectThisComputer(silent.deps), /did not finish connecting/)
})

test('a connected computer is reused, and started again when its host is off', async () => {
  const w = world({ environmentId: 'env-1', environments: [environment()], hostState: 'idle' })
  assert.equal((await ensureThisComputer(w.deps)).id, 'env-1')
  assert.ok(w.calls.includes('localComputer.setKeepAvailable'))
  assert.ok(!w.calls.includes('agentHost.start'))
})

test('a removed computer connects again', async () => {
  const w = world({ environmentId: 'env-1', environments: [environment({ status: 'revoked' })] })
  assert.equal((await ensureThisComputer(w.deps)).id, 'env-new')
})

test('choosing a folder approves it after the work folder; cancelling does nothing', async () => {
  const cancelled = world({ environmentId: 'env-1', environments: [environment()], hostState: 'running' })
  assert.equal(await chooseThisComputerFolder(cancelled.deps), null)
  assert.deepEqual(cancelled.roots(), [WORK])

  const w = world({ environmentId: 'env-1', environments: [environment()], hostState: 'running', picked: '/Users/sam/code/web/' })
  const chosen = await chooseThisComputerFolder(w.deps)
  assert.equal(chosen?.path, '/Users/sam/code/web')
  assert.deepEqual(w.roots(), [WORK, '/Users/sam/code/web'])
  // Choosing it again changes nothing.
  await chooseThisComputerFolder(w.deps)
  assert.deepEqual(w.roots(), [WORK, '/Users/sam/code/web'])
})

test('the first folder chosen on a new computer connects it too', async () => {
  const w = world({ picked: '/Users/sam/notes' })
  const chosen = await chooseThisComputerFolder(w.deps)
  assert.equal(chosen?.environment.id, 'env-new')
  assert.deepEqual(w.roots(), [WORK, '/Users/sam/notes'])
})

test('removing a folder keeps the others, and the work folder is never listed as chosen', async () => {
  const w = world({ environments: [environment({ filesystemGrant: { mode: 'selected_roots', roots: [WORK, '/a', '/b'] } })] })
  const updated = await removeThisComputerFolder(w.deps, environment({ filesystemGrant: { mode: 'selected_roots', roots: [WORK, '/a', '/b'] } }), '/a')
  assert.deepEqual(approvedRoots(updated), [WORK, '/b'])
  assert.deepEqual(chosenFolders(approvedRoots(updated), WORK), ['/b'])
  assert.equal(folderName('/Users/sam/code/web'), 'web')
})
