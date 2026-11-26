import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

/** One-time grant of Data and APIs to agents saved before the group existed (internal/develop/monid.md). */

const modules = import.meta.glob('./**/*.ts')
const now = 1_900_000_000_000
const API = ['search_apis', 'inspect_api', 'run_api', 'save_api_file']

test('the one-time update gives every agent with a saved tool list Data and APIs, once', async () => {
  const convex = convexTest(schema, modules)
  const ids = await convex.run(async (ctx) => {
    const make = (agentId: string, allowedToolIds: string[]) => ctx.db.insert('workspaceAgentDefinitions', {
      agentId, workspaceId: 'w', principalId: `p-${agentId}`, name: agentId, instructions: 'x', harness: 'overlay', visibility: 'workspace',
      modelId: 'm', allowedToolIds, invocationPolicy: 'mention', createdByPrincipalId: 'p-alice', createdAt: now, updatedAt: now,
    } as never)
    return {
      reader: await make('reader', ['search_knowledge', 'capability:web_search']),
      partial: await make('partial', ['write_file', 'search_apis']),
      already: await make('already', ['write_file', ...API]),
      empty: await make('empty', []),
    }
  })
  const migrate = makeFunctionReference<'mutation'>('migrations/grantApiTools:run')
  const apiTools = () => convex.run(async (ctx) => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([name, id]) =>
    [name, ((await ctx.db.get(id)) as { allowedToolIds: string[] }).allowedToolIds.filter((entry) => API.includes(entry)).length]))))

  expect(await convex.mutation(migrate, { dryRun: true })).toEqual({ granted: 2, isDone: true })
  expect(await apiTools()).toEqual({ reader: 0, partial: 1, already: 4, empty: 0 })
  expect(await convex.mutation(migrate, {})).toEqual({ granted: 2, isDone: true })
  expect(await apiTools()).toEqual({ reader: 4, partial: 4, already: 4, empty: 0 })
  expect(await convex.mutation(migrate, {})).toEqual({ granted: 0, isDone: true })
})
