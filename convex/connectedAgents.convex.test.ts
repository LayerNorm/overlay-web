import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import type { ConnectedAgentContractRepository } from '../src/shared/agents/connected-agent-repository-contract'
import { verifyConnectedAgentRepositoryContract } from '../src/shared/agents/connected-agent-repository-contract'

const modules = import.meta.glob('./**/*.ts')
const secret = 'connected-agent-contract-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

describe('Convex connected-agent provider contract', () => {
  test('rejects a missing server capability before reading tenant state', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.mutation(reference('createEnvironmentByServer'), {
      serverSecret: 'wrong-secret', id: 'environment', workspaceId: 'workspace', kind: 'local',
      name: 'Host', status: 'online', capabilities: {}, now: 1,
    })).rejects.toThrow(/Unauthorized/)
  })

  test('passes shared lifecycle, tenancy, ordering and deletion semantics', async () => {
    const convex = convexTest(schema, modules)
    const call = async <T>(operation: string, args: Record<string, unknown>): Promise<T> => {
      return await convex.mutation(reference(operation), { ...args, serverSecret: secret }) as T
    }
    const repository: ConnectedAgentContractRepository = {
      createEnvironment: (input) => call('createEnvironmentByServer', input),
      createBinding: (input) => call('createBindingByServer', input),
      createRemoteSession: (input) => call('createRemoteSessionByServer', input),
      enqueueCommand: (input) => call('enqueueCommandByServer', input),
      claimCommands: (input) => call('claimCommandsByServer', input),
      acknowledgeCommand: (input) => call('acknowledgeCommandByServer', input),
      createApprovalRequest: (input) => call('createApprovalRequestByServer', input),
      resolveApprovalRequest: (input) => call('resolveApprovalRequestByServer', input),
      createSandboxLease: (input) => call('createSandboxLeaseByServer', input),
      updateSandboxLease: (input) => call('updateSandboxLeaseByServer', input),
      applyRemoteEvents: (input) => call('applyRemoteEventsByServer', input),
      revokeEnvironment: (input) => call('revokeEnvironmentByServer', input),
      deleteWorkspaceData: (input) => call('deleteWorkspaceDataByServer', input),
    }
    await verifyConnectedAgentRepositoryContract({
      repository, prefix: 'convex_contract', workspaceId: 'workspace_owner',
      otherWorkspaceId: 'workspace_foreign', runId: 'run_owner',
    })
  })
})

function reference(operation: string) {
  return makeFunctionReference<'mutation'>(`agents/connectedAgents:${operation}`)
}
