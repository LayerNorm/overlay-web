import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { PlatformAgentAccess } from './PlatformAgentAccess'

const WORKSPACE = 'workspace-1'
const USER = 'user-creator'
const AGENT_PRINCIPAL = 'agent-principal-1'

function codedError(message: string, code: string) {
  return Object.assign(new Error(message), { code })
}

function createAccess(options: { linked?: boolean; guardFails?: boolean } = {}) {
  const calls: { listed: unknown[]; guard: unknown[]; created: unknown[] } = {
    listed: [],
    guard: [],
    created: [],
  }
  const access = new PlatformAgentAccess({
    governance: {
      async resolvePlatformActor() {
        if (options.linked === false) throw codedError('Platform identity is not linked', 'not_found')
        return { principalId: 'principal-1', userId: USER }
      },
    },
    workspaceAgents: {
      async list(args: unknown) {
        calls.listed.push(args)
        return { agents: [{ id: 'agent-1', visibility: 'workspace' }], canCreate: true }
      },
      async assertDirectMessageTargets(args: unknown) {
        calls.guard.push(args)
        if (options.guardFails) throw codedError('Agent not found', 'not_found')
      },
    },
    collaboration: {
      async createDirectMessage(args: unknown) {
        calls.created.push(args)
        return {
          conversationId: 'dm-1',
          workspaceId: WORKSPACE,
          title: 'Scout',
          participants: [],
          created: true,
        }
      },
    },
  } as never)
  return { access, calls }
}

test('platform list forwards the mapped user to the visibility-filtered directory', async () => {
  const { access, calls } = createAccess()
  const result = await access.listAgents({ workspaceId: WORKSPACE, directory: 'slack', externalId: 'U123' })
  assert.deepEqual(calls.listed, [{ actorUserId: USER, workspaceId: WORKSPACE }])
  assert.deepEqual(result.agents.map((agent) => agent.id), ['agent-1'])
})

test('platform list rejects unmapped users before touching agents', async () => {
  const { access, calls } = createAccess({ linked: false })
  await assert.rejects(() => access.listAgents({
    workspaceId: WORKSPACE, directory: 'slack', externalId: 'U999',
  }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'not_found')
  assert.deepEqual(calls.listed, [])
})

test('platform DM guards with the mapped actor, then creates', async () => {
  const { access, calls } = createAccess()
  const dm = await access.openAgentDirectMessage({
    workspaceId: WORKSPACE,
    directory: 'msteams',
    externalId: 'teams-user-1',
    agentPrincipalId: AGENT_PRINCIPAL,
    title: 'Scout',
  })
  assert.deepEqual(calls.guard, [{
    actorUserId: USER,
    workspaceId: WORKSPACE,
    principalIds: [AGENT_PRINCIPAL],
  }])
  assert.deepEqual(calls.created, [{
    actorUserId: USER,
    workspaceId: WORKSPACE,
    principalIds: [AGENT_PRINCIPAL],
    title: 'Scout',
  }])
  assert.equal(dm.conversationId, 'dm-1')
})

test('platform DM propagates the visibility guard without creating', async () => {
  const { access, calls } = createAccess({ guardFails: true })
  await assert.rejects(() => access.openAgentDirectMessage({
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalId: 'U123',
    agentPrincipalId: AGENT_PRINCIPAL,
  }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'not_found')
  assert.deepEqual(calls.created, [])
})
