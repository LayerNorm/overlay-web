import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const seed = makeFunctionReference<'mutation'>('dev/seed:init')
const stagingSeed = makeFunctionReference<'mutation'>('dev/seed:initStaging')
afterEach(() => vi.unstubAllEnvs())

test('Preview schedules exist on a fresh backend while unconfigured outbound delivery stays inert', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('OVERLAY_PREVIEW_BACKGROUND_JOBS', '')
  vi.stubEnv('OVERLAY_PREVIEW_EMAIL_RECIPIENTS', '')
  vi.stubEnv('OVERLAY_PREVIEW_WEBHOOK_ORIGINS', '')
  vi.resetModules()
  const { default: crons } = await import('./crons')
  expect(Object.keys(JSON.parse(crons.export()))).toContain('automation scheduler')
  const t = convexTest(schema, modules)
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Preview must not send outbound requests')
  })
  try {
    expect(await t.action(makeFunctionReference<'action'>('email/deliveryRunner:runMinuteTick'), {})).toBeNull()
    expect(await t.action(makeFunctionReference<'action'>('webhooks/deliveryRunner:runMinuteTick'), {})).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  } finally { fetchSpy.mockRestore() }
})

test('fresh Preview runs the same scheduled jobs as Production without a second deployment or opt-in', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('OVERLAY_PREVIEW_BACKGROUND_JOBS', '')
  vi.resetModules()
  const preview = JSON.parse((await import('./crons')).default.export())
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'production')
  vi.resetModules()
  const production = JSON.parse((await import('./crons')).default.export())
  expect(preview).toEqual(production)
  expect(Object.keys(preview)).toContain('automation scheduler')
  expect(Object.keys(preview)).toContain('usage reservation reconciliation')
})

test('preview seed refuses every non-preview deployment before writing', async () => {
  const t = convexTest(schema, modules)
  for (const environment of ['production', 'staging', 'development', '']) {
    vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
    await expect(t.mutation(seed, {})).rejects.toThrow('Preview seed is unavailable')
  }
  expect(await t.run((ctx) => ctx.db.query('subscriptions').take(1))).toHaveLength(0)
  expect(await t.run((ctx) => ctx.db.query('billingAccounts').take(1))).toHaveLength(0)
})

test('preview seed requires sandbox identity and creates fixtures idempotently', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', '')
  const t = convexTest(schema, modules)
  await expect(t.mutation(seed, {})).rejects.toThrow('sandbox preview login identity')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_preview_fixture')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'preview@example.test')
  const first = await t.mutation(seed, {})
  expect(await t.mutation(seed, {})).toEqual(first)
  const counts = await t.run(async (ctx) => ({
    users: (await ctx.db.query('subscriptions').take(5)).length,
    workspaces: (await ctx.db.query('workspaces').take(5)).length,
    members: (await ctx.db.query('workspaceMemberships').take(5)).length,
    conversations: (await ctx.db.query('conversations').take(5)).length,
    files: (await ctx.db.query('files').take(5)).length,
    automations: await ctx.db.query('automations').take(5),
  }))
  expect(counts).toMatchObject({ users: 1, workspaces: 1, members: 1, conversations: 1, files: 2 })
  expect(counts.automations).toHaveLength(1)
  expect(counts.automations[0]).toMatchObject({ enabled: false, status: 'paused' })
})

test('synthetic staging fixtures refuse customer production and preserve edits when repeated', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'staging')
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_01KJ9A19X317J7VWRWQ6XBME9Z')
  vi.stubEnv('STAGING_SMOKE_USER_ID', 'user_01M4R1EKTMDZ4E6BQ5DMZXD0F2')
  vi.stubEnv('STAGING_SMOKE_EMAIL', 'overlay-preview-qa@getoverlay.io')
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://colorful-chickadee-419.convex.cloud')
  const t = convexTest(schema, modules)
  await expect(t.mutation(stagingSeed, {})).rejects.toThrow('Synthetic staging seed is unavailable')
  expect(await t.run(ctx => ctx.db.query('files').take(1))).toHaveLength(0)
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://doting-cuttlefish-819.convex.cloud')
  const first = await t.mutation(stagingSeed, {})
  expect(first.workspaceId).toBe('staging-personal-' + first.userId)
  const note = await t.run(async ctx => {
    const row = await ctx.db.query('files').withIndex('by_userId_clientId', q =>
      q.eq('userId', first.userId).eq('clientId', 'staging-seed-note-v1')).unique()
    if (!row) throw new Error('Missing staging note')
    await ctx.db.patch(row._id, { content: 'Preserved QA edit' })
    return row._id
  })
  expect(await t.mutation(stagingSeed, {})).toEqual(first)
  expect(await t.run(async ctx => (await ctx.db.get(note))?.content)).toBe('Preserved QA edit')
  expect(await t.run(ctx => ctx.db.query('files').take(5))).toHaveLength(2)
})


test('preview repair reuses an existing personal workspace and preserves unrelated data', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_preview_fixture')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'preview@example.test')
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'existing-personal', kind: 'personal', name: 'Preserved name',
      slug: 'existing-personal', status: 'active', personalOwnerUserId: 'user_preview_fixture',
      createdByPrincipalId: 'existing-human', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspacePrincipals', { principalId: 'existing-human', workspaceId: 'existing-personal',
      type: 'human', userId: 'user_preview_fixture', displayName: 'Preserved owner', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'existing-member', workspaceId: 'existing-personal',
      principalId: 'existing-human', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 })
  })
  expect((await t.mutation(seed, {})).workspaceId).toBe('existing-personal')
  expect((await t.mutation(seed, {})).workspaceId).toBe('existing-personal')
  const rows = await t.run(async ctx => ({ workspaces: await ctx.db.query('workspaces').take(5),
    files: await ctx.db.query('files').take(5), members: await ctx.db.query('workspaceMemberships').take(5) }))
  expect(rows.workspaces).toHaveLength(1)
  expect(rows.workspaces[0].name).toBe('Preserved name')
  expect(rows.members).toHaveLength(1)
  expect(rows.files).toHaveLength(2)
  expect(rows.files.every(f => f.workspaceId === 'existing-personal')).toBe(true)
})

test('Computer QA funds only its workspace and never refills or resets it on reseed', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_preview_fixture')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'preview@example.test')
  const t = convexTest(schema, modules)
  await t.mutation(makeFunctionReference<'mutation'>('dev/seed:initComputerQa'), {})
  const account = await t.run(async ctx => {
    const accounts = await ctx.db.query('billingAccounts').collect()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ scope: 'workspace', workspaceId: 'preview-computer-qa-user_preview_fixture' })
    const subscription = await ctx.db.query('billingAccountSubscriptions').unique()
    expect(subscription).toMatchObject({ planKind: 'paid', planAmountCents: 500, provider: 'preview-fixture', autoTopUpEnabled: false })
    expect(subscription?.providerCustomerId).toBeUndefined()
    expect(subscription?.providerSubscriptionId).toBeUndefined()
    const balance = await ctx.db.query('billingAccountBalances').unique()
    expect(balance).toMatchObject({ includedMicros: 5_000_000, usedMicros: 0, reservedMicros: 0, mode: 'budgeted' })
    if (!balance || !subscription) throw new Error('Missing QA billing fixture')
    await ctx.db.patch(balance._id, { usedMicros: 1_000_000, reservedMicros: 500_000, includedMicros: 1_500_000 })
    await ctx.db.patch(subscription._id, { planKind: 'free', planAmountCents: 0, status: 'canceled' })
    return accounts[0]
  })
  await t.mutation(makeFunctionReference<'mutation'>('dev/seed:initComputerQa'), {})
  const rows = await t.run(async ctx => ({
    balance: await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', q => q.eq('billingAccountId', account.billingAccountId)).unique(),
    subscription: await ctx.db.query('billingAccountSubscriptions').withIndex('by_billingAccountId', q => q.eq('billingAccountId', account.billingAccountId)).unique(),
  }))
  expect(rows.balance).toMatchObject({ usedMicros: 1_000_000, reservedMicros: 500_000, includedMicros: 1_500_000 })
  expect(rows.subscription).toMatchObject({ planKind: 'free', status: 'canceled', planAmountCents: 0 })
})

test.each(['production', 'staging', 'development'])('Computer QA seed refuses %s before writing', async (environment) => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
  const t = convexTest(schema, modules)
  await expect(t.mutation(makeFunctionReference<'mutation'>('dev/seed:initComputerQa'), {})).rejects.toThrow('Preview seed is unavailable')
  expect(await t.run(ctx => ctx.db.query('billingAccounts').collect())).toHaveLength(0)
})
