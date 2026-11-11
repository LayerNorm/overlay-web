import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { insertPushNotification, insertPushApproval } from './lib/mobilePush'

const modules = import.meta.glob('./**/*.ts')
const register = makeFunctionReference<'mutation'>('notifications/tokens:register')
const unregister = makeFunctionReference<'mutation'>('notifications/tokens:unregister')
const pending = makeFunctionReference<'query'>('notifications/push:pending')
const deliver = makeFunctionReference<'action'>('notifications/push:deliver')
const receipts = makeFunctionReference<'action'>('notifications/push:receipts')
const token = 'ExpoPushToken[device-one]'
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function fixture() {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'ws',
      kind: 'organization',
      name: 'QA',
      slug: 'qa',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert('workspacePrincipals', {
      workspaceId: 'ws',
      principalId: 'p',
      userId: 'alice',
      type: 'human',
      displayName: 'Alice',
      createdAt: 1,
      updatedAt: 1,
    })
    const membership = await ctx.db.insert('workspaceMemberships', {
      workspaceId: 'ws',
      principalId: 'p',
      membershipId: 'm',
      role: 'member',
      status: 'active',
      joinedAt: 1,
      updatedAt: 1,
    })
    const room = await ctx.db.insert('conversations', {
      workspaceId: 'ws',
      userId: 'alice',
      title: 'general',
      conversationType: 'channel',
      scope: 'workspace',
      askModelIds: [],
      actModelId: 'model',
      lastMode: 'act',
      createdAt: 1,
      lastModified: 1,
    })
    const participant = await ctx.db.insert('conversationParticipants', {
      conversationId: room,
      workspaceId: 'ws',
      principalId: 'p',
      principalType: 'human',
      role: 'member',
      status: 'active',
      notificationLevel: 'all',
      joinedAt: 1,
      updatedAt: 1,
    })
    const notification = await ctx.db.insert('workspaceNotifications', {
      notificationId: 'n',
      workspaceId: 'ws',
      recipientPrincipalId: 'p',
      conversationId: room,
      actorPrincipalId: 'other',
      type: 'mention',
      title: 'Mention',
      body: 'Preview '.repeat(100),
      createdAt: 1,
    })
    return { room, notification, participant, membership }
  })
  const alice = t.withIdentity({ subject: 'alice' })
  const bob = t.withIdentity({ subject: 'bob' })
  const source = { kind: 'activity', id: ids.notification }
  await alice.mutation(register, { expoToken: token, deviceId: 'device', platform: 'ios' })
  return { t, alice, bob, ids, source }
}

test('registration authenticates, validates and deduplicates, moves ownership and unregisters only the caller device', async () => {
  const { t, alice, bob } = await fixture()
  await expect(
    t.mutation(register, { expoToken: token, deviceId: 'x', platform: 'ios' }),
  ).rejects.toThrow('UNAUTHENTICATED')
  await expect(
    alice.mutation(register, { expoToken: 'raw-apns-token', deviceId: 'x', platform: 'ios' }),
  ).rejects.toThrow('INVALID_PUSH_TOKEN')
  await expect(
    alice.mutation(register, { expoToken: token, deviceId: '', platform: 'ios' }),
  ).rejects.toThrow('INVALID_PUSH_TOKEN')
  const id = await alice.mutation(register, {
    expoToken: token,
    deviceId: 'device',
    platform: 'ios',
  })
  expect(
    await bob.mutation(register, { expoToken: token, deviceId: 'device', platform: 'android' }),
  ).toBe(id)
  await alice.mutation(unregister, { deviceId: 'device' })
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    userId: 'bob',
    platform: 'android',
  })
  expect((await t.run((ctx) => ctx.db.get(id)))?.revokedAt).toBeUndefined()
  await bob.mutation(unregister, { deviceId: 'device' })
  expect((await t.run((ctx) => ctx.db.get(id)))?.revokedAt).toBeDefined()
  await bob.mutation(register, { expoToken: token, deviceId: 'device', platform: 'android' })
  expect(await t.run((ctx) => ctx.db.query('pushTokens').collect())).toHaveLength(1)
  expect((await t.run((ctx) => ctx.db.get(id)))?.revokedAt).toBeUndefined()
})

test('token rotation revokes the previous installation binding but leaves other devices registered', async () => {
  const { t, alice } = await fixture()
  await alice.mutation(register, {
    expoToken: 'ExponentPushToken[second]',
    deviceId: 'second',
    platform: 'android',
  })
  await alice.mutation(register, {
    expoToken: 'ExpoPushToken[rotated]',
    deviceId: 'device',
    platform: 'ios',
  })
  const rows = await t.run((ctx) => ctx.db.query('pushTokens').collect())
  expect(rows.find((row) => row.expoToken === token)?.revokedAt).toBeDefined()
  expect(rows.filter((row) => row.revokedAt === undefined)).toHaveLength(2)
})

test('approval creation queues a preview-safe attention alert and resolution/terminal runs suppress it', async () => {
  const { t, ids } = await fixture()
  const seeded = await t.run(async (ctx) => {
    const userMessageId = await ctx.db.insert('conversationMessages', {
      conversationId: ids.room,
      userId: 'alice',
      turnId: 'turn',
      role: 'user',
      mode: 'act',
      content: 'private',
      contentType: 'text',
      createdAt: 1,
      updatedAt: 1,
    })
    const run = await ctx.db.insert('conversationAgentRuns', {
      conversationId: ids.room,
      userId: 'alice',
      turnId: 'turn',
      userMessageId,
      assistantMessageId: userMessageId,
      mode: 'room',
      runner: 'remote',
      externalRunId: 'external',
      status: 'waiting_for_approval',
      createdAt: 1,
      updatedAt: 1,
    })
    const approval = await insertPushApproval(ctx, {
      approvalId: 'approval',
      workspaceId: 'ws',
      runId: 'external',
      remoteSessionId: 'session',
      requestKey: 'request',
      kind: 'permission',
      prompt: 'private tool content',
      options: [],
      payload: { secret: 'not for push' },
      requestedAt: 1,
    })
    return { run, approval }
  })
  const source = { kind: 'approval', id: seeded.approval }
  expect(await t.query(pending, { source })).toMatchObject({
    title: 'Approval needed',
    body: 'An agent needs your attention.',
  })
  expect(
    (await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).some(
      (row) => row.name === 'notifications/push:deliver',
    ),
  ).toBe(true)
  await t.run((ctx) =>
    ctx.db.patch(seeded.approval, {
      resolution: { decision: 'deny', resolvedByPrincipalId: 'p', resolvedAt: 2 },
    }),
  )
  expect(await t.query(pending, { source })).toBeNull()
  await t.run((ctx) => ctx.db.patch(seeded.approval, { resolution: undefined }))
  await t.run((ctx) => ctx.db.patch(seeded.run, { status: 'waiting_for_children' }))
  expect((await t.query(pending, { source })).targets).toHaveLength(1)
  await t.run((ctx) => ctx.db.patch(seeded.run, { status: 'completed' }))
  expect(await t.query(pending, { source })).toBeNull()
})

test('account deletion purges user push registrations', async () => {
  const { t } = await fixture()
  vi.stubEnv('INTERNAL_API_SECRET', 'push-deletion-secret')
  await t.mutation(makeFunctionReference<'mutation'>('auth/users:deleteUserAccountByServer'), {
    serverSecret: 'push-deletion-secret',
    userId: 'alice',
  })
  expect(await t.run((ctx) => ctx.db.query('pushTokens').collect())).toEqual([])
})

test('push uses only the existing preview, honors activity-only/off preferences, mute and current membership/read state', async () => {
  const { t, ids, source } = await fixture()
  const normal = await t.query(pending, { source })
  expect(normal.body).toHaveLength(240)
  expect(normal.url).toContain(`/channel/${ids.room}?workspaceId=ws`)
  expect(normal.targets).toHaveLength(1)
  const pref = await t.run((ctx) =>
    ctx.db.insert('workspaceNotificationPreferences', {
      workspaceId: 'ws',
      principalId: 'p',
      dmMessages: 'banner',
      channelMessages: 'banner',
      mentions: 'activity',
      threadReplies: 'banner',
      reactions: 'banner',
      updatedAt: 1,
    }),
  )
  expect(await t.query(pending, { source })).toBeNull()
  await t.run((ctx) => ctx.db.patch(pref, { mentions: 'off' }))
  expect(await t.query(pending, { source })).toBeNull()
  await t.run((ctx) => ctx.db.patch(pref, { mentions: 'banner' }))
  await t.run((ctx) => ctx.db.patch(ids.participant, { notificationLevel: 'muted' }))
  expect(await t.query(pending, { source })).toBeNull()
  await t.run((ctx) => ctx.db.patch(ids.participant, { notificationLevel: 'mentions' }))
  expect((await t.query(pending, { source })).targets).toHaveLength(1)
  await t.run((ctx) => ctx.db.patch(ids.notification, { type: 'message' }))
  expect(await t.query(pending, { source })).toBeNull()
  await t.run((ctx) => ctx.db.patch(ids.participant, { notificationLevel: 'all' }))
  expect((await t.query(pending, { source })).targets).toHaveLength(1)
  await t.run((ctx) => ctx.db.patch(ids.notification, { readAt: 0 }))
  expect(await t.query(pending, { source })).toBeNull()
  await t.run((ctx) => ctx.db.patch(ids.notification, { readAt: undefined }))
  await t.run((ctx) => ctx.db.delete(ids.membership))
  expect(await t.query(pending, { source })).toBeNull()
})

test('Expo send batches at 100, schedules receipts, revokes invalid devices and never revokes a moved/re-registered token', async () => {
  const { t, alice, bob, source } = await fixture()
  await t.run(async (ctx) => {
    for (let i = 0; i < 100; i++)
      await ctx.db.insert('pushTokens', {
        userId: 'alice',
        expoToken: `ExpoPushToken[${i}]`,
        platform: 'ios',
        deviceId: `${i}`,
        updatedAt: 1,
      })
  })
  vi.stubEnv('EXPO_ACCESS_TOKEN', 'test-token')
  const requests: { path: string; body: unknown; authorization: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      requests.push({
        path: url,
        body,
        authorization: new Headers(options.headers).get('Authorization'),
      })
      return Response.json({
        data: body.map((_value: unknown, index: number) => ({
          status: 'ok',
          id: `receipt-${requests.length}-${index}`,
        })),
      })
    }),
  )
  await t.action(deliver, { source })
  expect(requests.map((row) => (row.body as unknown[]).length)).toEqual([100, 1])
  expect(requests[0]!.authorization).toBe('Bearer test-token')
  await t.action(receipts, { tickets: [], attempt: 0 })
  expect(requests).toHaveLength(2)
  expect((requests[0]!.body as { data: unknown }[])[0]!.data).toEqual({
    url: expect.stringContaining('notificationType=mention'),
  })
  const snapshot = (await t.query(pending, { source })).targets.find(
    (row: { token: string }) => row.token === token,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        data: { expired: { status: 'error', details: { error: 'DeviceNotRegistered' } } },
      }),
    ),
  )
  await bob.mutation(register, { expoToken: token, deviceId: 'bob-device', platform: 'android' })
  await t.action(receipts, { tickets: [{ id: 'expired', target: snapshot }], attempt: 0 })
  expect(
    (
      await t.run((ctx) =>
        ctx.db
          .query('pushTokens')
          .withIndex('by_token', (q) => q.eq('expoToken', token))
          .unique(),
      )
    )?.revokedAt,
  ).toBeUndefined()
  await alice.mutation(register, { expoToken: token, deviceId: 'device', platform: 'ios' })
  await t.action(receipts, { tickets: [{ id: 'expired', target: snapshot }], attempt: 0 })
  expect(
    (
      await t.run((ctx) =>
        ctx.db
          .query('pushTokens')
          .withIndex('by_token', (q) => q.eq('expoToken', token))
          .unique(),
      )
    )?.revokedAt,
  ).toBeUndefined()
  const fresh = (await t.query(pending, { source })).targets.find(
    (row: { token: string }) => row.token === token,
  )
  await t.action(receipts, { tickets: [{ id: 'expired', target: fresh }], attempt: 0 })
  expect(
    (
      await t.run((ctx) =>
        ctx.db
          .query('pushTokens')
          .withIndex('by_token', (q) => q.eq('expoToken', token))
          .unique(),
      )
    )?.revokedAt,
  ).toBeDefined()
})

test('notification creation atomically queues delivery and transport errors do not revoke healthy tokens', async () => {
  const { t, ids, source } = await fixture()
  await t.run((ctx) =>
    insertPushNotification(ctx, {
      notificationId: 'queued',
      workspaceId: 'ws',
      recipientPrincipalId: 'p',
      conversationId: ids.room,
      actorPrincipalId: 'other',
      type: 'reaction',
      title: 'Reaction',
      createdAt: 1,
    }),
  )
  expect(
    (await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).some(
      (row) => row.name === 'notifications/push:deliver',
    ),
  ).toBe(true)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  )
  await expect(t.action(deliver, { source })).rejects.toThrow('503')
  expect((await t.query(pending, { source })).targets).toHaveLength(1)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
    ),
  )
  await t.action(deliver, { source })
  expect((await t.query(pending, { source })).targets).toHaveLength(0)
  await expect(t.action(deliver, { source })).resolves.toBeNull()
})
