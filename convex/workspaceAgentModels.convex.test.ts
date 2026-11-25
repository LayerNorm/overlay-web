import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { NEW_AGENT_DEFAULT_MODEL_ID } from '../src/shared/ai/gateway/model-types'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-models-secret'
const move = makeFunctionReference<'mutation'>('migrations/workspaceAgentModels:moveWorkspaceAgentsOffPersonalModelsByServer')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

test('workspace agents on personal providers move to the default Overlay model; the rest are left alone', async () => {
  const convex = convexTest(schema, modules)
  const ids = await convex.run(async (ctx) => {
    const connection = (scope: 'personal' | 'workspace', workspaceId?: string) => ctx.db.insert('userProviderConnections', {
      userId: 'owner', providerId: 'openai', scope, ...(workspaceId ? { workspaceId } : {}), endpoint: 'https://api.openai.com/v1',
      displayName: scope, vaultKeyName: 'k', enabledModelIds: ['gpt'], status: 'active', isDefault: false, isDeletable: true,
      createdAt: 1, updatedAt: 1,
    } as never)
    const personal = await connection('personal')
    const shared = await connection('workspace', 'ws')
    const otherWorkspace = await connection('workspace', 'ws-other')
    const agent = (agentId: string, modelId: string, extra: Record<string, unknown> = {}) => ctx.db.insert('workspaceAgentDefinitions', {
      agentId, workspaceId: 'ws', principalId: `p-${agentId}`, name: agentId, instructions: '', harness: 'overlay', modelId,
      allowedToolIds: [], invocationPolicy: 'mention', visibility: 'workspace', createdByPrincipalId: 'p-owner',
      createdAt: 1, updatedAt: 1, ...extra,
    } as never)
    await agent('on-personal', `byok/${personal}/gpt`)
    await agent('on-other-workspace', `byok/${otherWorkspace}/gpt`)
    await agent('on-missing', 'byok/missing/gpt')
    await agent('on-workspace', `byok/${shared}/gpt`)
    await agent('hosted', 'anthropic/claude-sonnet-5.5')
    await agent('private', `byok/${personal}/gpt`, { visibility: 'creator' })
    return { personal }
  })
  const run = (dryRun: boolean) => convex.mutation(move, { serverSecret: secret, dryRun }) as Promise<{ moved: Array<{ agentId: string }> }>
  const dry = await run(true)
  expect(dry.moved.map((row) => row.agentId).sort()).toEqual(['on-missing', 'on-other-workspace', 'on-personal'])
  await run(false)
  const models = await convex.run(async (ctx) => Object.fromEntries(
    (await ctx.db.query('workspaceAgentDefinitions').collect()).map((row) => [row.agentId, row.modelId])))
  expect(models['on-personal']).toBe(NEW_AGENT_DEFAULT_MODEL_ID)
  expect(models['on-missing']).toBe(NEW_AGENT_DEFAULT_MODEL_ID)
  expect(models['on-workspace']).toMatch(/^byok\//)
  expect(models.hosted).toBe('anthropic/claude-sonnet-5.5')
  expect(models.private).toBe(`byok/${ids.personal}/gpt`)
  expect((await run(true)).moved).toEqual([])
})
