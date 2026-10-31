import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const migrate = makeFunctionReference<'mutation'>('migrations/doubleSidebar:enableExistingAccounts')

test('rollout is paginated, dry-runnable, and changes only the sidebar preference', async () => {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    for (let i = 0; i < 3; i++) await ctx.db.insert('userUiSettings', {
      userId: `sidebar-qa-${i}`, theme: 'dark', useSecondarySidebar: i === 2,
      sendWithEnter: false, createdAt: 1, updatedAt: 2,
    })
  })
  const before = await t.run(ctx => ctx.db.query('userUiSettings').collect())
  const preview = await t.mutation(migrate, { paginationOpts: { numItems: 1, cursor: null }, dryRun: true })
  expect(preview).toMatchObject({ scanned: 1, changed: 1, isDone: false })
  expect(await t.run(ctx => ctx.db.query('userUiSettings').collect())).toEqual(before)
  let cursor = null
  let changed = 0
  for (;;) {
    const page = await t.mutation(migrate, { paginationOpts: { numItems: 1, cursor }, dryRun: false })
    changed += page.changed
    if (page.isDone) break
    cursor = page.continueCursor
  }
  expect(changed).toBe(2)
  const after = await t.run(ctx => ctx.db.query('userUiSettings').collect())
  expect(after).toEqual(before.map(row => ({ ...row, useSecondarySidebar: true })))
  expect((await t.mutation(migrate, { paginationOpts: { numItems: 100, cursor: null }, dryRun: false })).changed).toBe(0)
})
