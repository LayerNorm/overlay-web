import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const status = makeFunctionReference<'query'>('imports/slackBrowse:status')

type Status = { connected: boolean; jobs: Array<{ _id: string; status: string; processedChannels?: number }> }

async function fixture() {
  const t = convexTest(schema, modules)
  const jobId = await t.run(async ctx => {
    for (const ws of ['ws', 'other']) {
      await ctx.db.insert('workspaces', { workspaceId: ws, kind: 'organization', name: ws, slug: ws, status: 'active', createdAt: 1, updatedAt: 1 })
    }
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    await ctx.db.insert('workspaceConnectors', { workspaceId: 'ws', userId: 'alice', providerKey: 'slackbot', connectedAccountId: 'ca_SECRET', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('slackImportJobs', {
      userId: 'alice', workspaceId: 'other', connectedAccountId: 'ca_OTHER', status: 'importing', selectedChannelIds: ['C9'], createdAt: 3, updatedAt: 3,
    })
    return await ctx.db.insert('slackImportJobs', {
      userId: 'alice', workspaceId: 'ws', connectedAccountId: 'ca_SECRET', status: 'importing', selectedChannelIds: ['C1', 'C2'],
      totalChannels: 2, processedChannels: 0, createdAt: 2, updatedAt: 2,
    })
  })
  return { t, as: (subject: string) => t.withIdentity({ subject }), jobId }
}

test('members see the workspace import jobs and their own Slack connection; connector references never leave', async () => {
  const { as, jobId } = await fixture()
  const alice = await as('alice').query(status, { workspaceId: 'ws' }) as Status
  expect(alice.connected).toBe(true)
  expect(alice.jobs.map(job => job._id)).toEqual([jobId])
  expect(JSON.stringify(alice)).not.toMatch(/ca_|SECRET|connectedAccountId/)
  // Bob sees the job but has not connected his own Slack.
  const bob = await as('bob').query(status, { workspaceId: 'ws' }) as Status
  expect(bob).toMatchObject({ connected: false, jobs: [{ _id: jobId }] })
  expect(await as('stranger').query(status, { workspaceId: 'ws' })).toBeNull()
})

test('progress written by the runner shows live', async () => {
  const { t, as, jobId } = await fixture()
  await t.run(async ctx => { await ctx.db.patch(jobId, { processedChannels: 2, status: 'completed', completedAt: 9 }) })
  expect((await as('alice').query(status, { workspaceId: 'ws' }) as Status).jobs[0]).toMatchObject({ status: 'completed', processedChannels: 2 })
})
