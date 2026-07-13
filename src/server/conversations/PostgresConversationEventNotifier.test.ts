import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Notification, Pool, PoolClient } from 'pg'
import {
  CONVERSATION_EVENT_NOTIFY_CHANNEL,
  PostgresConversationEventNotifier,
} from './PostgresConversationEventNotifier'

class FakeClient extends EventEmitter {
  destroyed = false
  queries: string[] = []

  async query(query: string): Promise<{ rows: unknown[] }> {
    this.queries.push(query)
    return { rows: [] }
  }

  release(destroy?: boolean | Error): void {
    this.destroyed = Boolean(destroy)
    if (destroy) {
      // pg can emit another socket error after release(true). The notifier must
      // keep the listener attached until destruction completes.
      this.emit('error', Object.assign(new Error('secondary socket error'), { code: 'ECONNRESET' }))
      this.emit('end')
    }
  }
}

test('notification listener reconnects after connection and socket failures', async () => {
  const first = new FakeClient()
  const second = new FakeClient()
  let connects = 0
  const pool = {
    connect: async () => {
      connects += 1
      if (connects === 1) throw Object.assign(new Error('failover in progress'), { code: '57P01' })
      return (connects === 2 ? first : second) as unknown as PoolClient
    },
  } as Pick<Pool, 'connect'>
  const notifier = new PostgresConversationEventNotifier(pool, {
    random: () => 0.5,
    reconnectBaseMs: 10,
    reconnectMaximumMs: 10,
  })

  const firstWaiter = await notifier.createWaiter({ timeoutMs: 1_000, userId: 'user_1' })
  await waitFor(() => notifier.getHealth().connected)
  assert.equal(connects, 2)
  assert.deepEqual(first.queries, [`LISTEN ${CONVERSATION_EVENT_NOTIFY_CHANNEL}`])

  first.emit('notification', {
    channel: CONVERSATION_EVENT_NOTIFY_CHANNEL,
    payload: 'user_1',
    processId: 1,
  } satisfies Notification)
  await firstWaiter.promise

  first.emit('error', Object.assign(new Error('writer failed over'), { code: '57P01' }))
  await waitFor(() => notifier.getHealth().connected && connects === 3)
  assert.equal(first.destroyed, true)
  assert.deepEqual(second.queries, [`LISTEN ${CONVERSATION_EVENT_NOTIFY_CHANNEL}`])
  assert.equal(notifier.getHealth().lastError, undefined)

  await notifier.close()
  assert.equal(notifier.getHealth().state, 'closed')
})

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for notifier state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
