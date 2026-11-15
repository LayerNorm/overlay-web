import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SyncAccountRevokedError, SyncRateLimitedError, type SyncOutboundAdapter } from './adapters'
import { runSyncOutbound, type SyncOutboxRelease, type SyncOutboxStore, type SyncOutboxWork } from './outbound-worker'
import { sealSyncToken } from './token-seal'

process.env.SLACK_ENCRYPTION_KEY = 'b'.repeat(64)

const link = { linkId: 'link', workspaceId: 'ws', provider: 'slack' as const, externalOrgId: 'T1', externalChannelId: 'C1', conversationId: 'conv' }

function work(overrides: Partial<SyncOutboxWork>): SyncOutboxWork {
  return { outboxId: 'row', action: 'post', attempts: 1, link, actorUserId: 'user_1', externalUserId: 'U1', sealedToken: sealSyncToken('xoxp-1'), content: 'hi', ...overrides }
}

function memoryStore(batches: SyncOutboxWork[][]) {
  const completed: Array<{ outboxId: string; externalMessageId?: string; externalThreadId?: string }> = []
  const released: SyncOutboxRelease[] = []
  const store: SyncOutboxStore = {
    claimDue: async () => batches.shift() ?? [],
    complete: async args => { completed.push(args) },
    release: async args => { released.push(args) },
  }
  return { store, completed, released }
}

function recordingAdapter(fail?: (action: string) => Error | undefined) {
  const calls: string[] = []
  const check = (action: string) => {
    calls.push(action)
    const error = fail?.(action)
    if (error) throw error
  }
  const adapter: SyncOutboundAdapter = {
    provider: 'slack',
    post: async (_link, credential, message) => {
      check('post:' + credential.accessToken + ':' + (message.externalThreadId ?? '-'))
      return { externalMessageId: '1700.1' }
    },
    edit: async (_link, _credential, ts, message) => { check('edit:' + ts + ':' + message.content) },
    remove: async (_link, _credential, ts) => { check('remove:' + ts) },
    react: async (_link, _credential, ts, emoji, enabled) => { check((enabled ? 'react:' : 'unreact:') + ts + ':' + emoji) },
  }
  return { adapter, calls }
}

test('sends each claimed row with the opened member token and records the result', async () => {
  const { store, completed, released } = memoryStore([[
    work({ outboxId: 'a', externalThreadId: '1600.1' }),
    work({ outboxId: 'b', action: 'edit', externalMessageId: '1600.2', content: 'new' }),
    work({ outboxId: 'c', action: 'delete', externalMessageId: '1600.3' }),
    work({ outboxId: 'd', action: 'unreact', externalMessageId: '1600.4', emoji: '🎉' }),
  ]])
  const { adapter, calls } = recordingAdapter()
  assert.deepEqual(await runSyncOutbound({ store, adapters: { slack: adapter } }), { sent: 4, failed: 0 })
  assert.deepEqual(calls, ['post:xoxp-1:1600.1', 'edit:1600.2:new', 'remove:1600.3', 'unreact:1600.4:🎉'])
  assert.deepEqual(completed, [{ outboxId: 'a', externalMessageId: '1700.1', externalThreadId: '1600.1' }, { outboxId: 'b' }, { outboxId: 'c' }, { outboxId: 'd' }])
  assert.deepEqual(released, [])
})

test('failures are released with the right retry policy and never carry the token', async () => {
  const { store, released } = memoryStore([[
    work({ outboxId: 'limited' }),
    work({ outboxId: 'revoked', action: 'edit', externalMessageId: '1' }),
    work({ outboxId: 'flaky', action: 'delete', externalMessageId: '2' }),
    work({ outboxId: 'teams', link: { ...link, provider: 'teams' } }),
  ]])
  const { adapter } = recordingAdapter(action => action.startsWith('post') ? new SyncRateLimitedError(9000)
    : action.startsWith('edit') ? new SyncAccountRevokedError('Slack rejected the member token: token_revoked')
      : new Error('socket hang up'))
  assert.deepEqual(await runSyncOutbound({ store, adapters: { slack: adapter } }), { sent: 0, failed: 4 })
  assert.deepEqual(released.map(row => [row.outboxId, row.retryAfterMs ?? null, Boolean(row.permanent), Boolean(row.revokeAccount), Boolean(row.refundAttempt)]), [
    ['limited', 9000, false, false, true],
    ['revoked', null, true, true, false],
    ['flaky', null, false, false, false],
    ['teams', null, true, false, false],
  ])
  assert.equal(JSON.stringify(released).includes('xoxp'), false)
})

test('stops when the queue is empty', async () => {
  const { store } = memoryStore([])
  const { adapter, calls } = recordingAdapter()
  assert.deepEqual(await runSyncOutbound({ store, adapters: { slack: adapter } }), { sent: 0, failed: 0 })
  assert.deepEqual(calls, [])
})
