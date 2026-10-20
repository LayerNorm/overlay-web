import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'provider-inventory-secret'
const query = makeFunctionReference<'query'>('agents/providerInventory:listKnownProviderReferencesByServer')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

describe('Convex provider inventory ownership lookup', () => {
  test('finds leases, provisions, and Computers only for the requested provider', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async (ctx) => {
      await ctx.db.insert('agentSandboxLeases', {
        leaseId: 'lease-e2b', workspaceId: 'workspace', provider: 'e2b', providerReference: 'lease-ref',
        status: 'running', reservedUntil: 1_000, usage: {}, cleanupAttempts: 0, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('agentSandboxLeases', {
        leaseId: 'lease-released', workspaceId: 'workspace', provider: 'e2b', providerReference: 'released-ref',
        status: 'released', reservedUntil: 1_000, usage: {}, cleanupAttempts: 0, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('agentSandboxLeases', {
        leaseId: 'lease-box', workspaceId: 'workspace', provider: 'box', providerReference: 'box-ref',
        status: 'running', reservedUntil: 1_000, usage: {}, cleanupAttempts: 0, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('cloudAgentProvisions', {
        workspaceId: 'workspace', agentId: 'agent', userId: 'user', phase: 'failed',
        provider: 'e2b', providerReference: 'provision-ref', createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('cloudAgentProvisions', {
        workspaceId: 'workspace', agentId: 'other-agent', userId: 'user', phase: 'failed',
        provider: 'box', providerReference: 'box-provision-ref', createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('computers', {
        id: 'computer', workspaceId: 'workspace', ownerType: 'user', ownerId: 'user',
        provider: 'e2b', providerRef: 'computer-ref', size: 'small', status: 'ready',
        createdBy: 'user', createdAt: 1, updatedAt: 1,
      })
    })

    const args = { serverSecret: secret, provider: 'e2b' as const }
    expect(await convex.query(query, {
      ...args, references: ['lease-ref', 'provision-ref', 'computer-ref', 'released-ref', 'box-ref'],
    })).toEqual(['lease-ref', 'provision-ref', 'computer-ref'])
    expect(await convex.query(query, {
      serverSecret: secret, provider: 'box', references: ['lease-ref', 'provision-ref', 'box-ref', 'box-provision-ref'],
    })).toEqual(['box-ref', 'box-provision-ref'])
    await expect(convex.query(query, {
      ...args, references: Array.from({ length: 201 }, (_, index) => `ref-${index}`),
    })).rejects.toThrow('provider_inventory_reference_limit_exceeded')
    await expect(convex.query(query, {
      ...args, serverSecret: 'wrong', references: [],
    })).rejects.toThrow(/Unauthorized/)
  })
})
