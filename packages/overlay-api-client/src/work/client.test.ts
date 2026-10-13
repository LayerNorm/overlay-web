import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOverlayAppClient } from '../create-overlay-app-client'

test('work client sends typed methods, encoded IDs, revisions and workspace headers', async () => {
  const requests: { url: string; method: string; body?: unknown; workspace: string | null }[] = []
  const client = createOverlayAppClient({
    baseUrl: 'https://preview.example.test',
    getAuthHeaders: () => ({ 'x-overlay-workspace-id': 'ws-1' }),
    fetch: async (url, init) => {
      requests.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        workspace: new Headers(init?.headers).get('x-overlay-workspace-id'),
      })
      return requests.length === 1
        ? Response.json({ data: [{ _id: 'task-1' }], hasMore: false, nextCursor: null })
        : Response.json({ success: true })
    },
  })
  const tasks = await client.work.list('personal')
  assert.deepEqual(
    tasks.map((task) => task._id),
    ['task-1'],
  )
  await client.work.create({ title: 'Ship', scope: 'workspace' })
  await client.work.get('task-1')
  await client.work.update('task-1', { expectedUpdatedAt: 42, patch: { status: 'review' } })
  await client.work.action('task-1', { action: 'comment', text: 'Reviewed' })
  await client.work.archive('task-1')
  assert.deepEqual(
    requests.map((r) => r.method),
    ['GET', 'POST', 'GET', 'PATCH', 'POST', 'DELETE'],
  )
  assert.equal(requests[0].url, 'https://preview.example.test/api/v1/work?view=personal&limit=200')
  assert.equal(requests[3].url, 'https://preview.example.test/api/v1/work/task-1')
  assert.deepEqual(requests[3].body, { expectedUpdatedAt: 42, patch: { status: 'review' } })
  assert.ok(requests.every((r) => r.workspace === 'ws-1'))
})

test('work client follows all pages, deduplicates updates and rejects repeated cursors', async () => {
  let calls = 0
  const client = createOverlayAppClient({
    fetch: async () =>
      Response.json(
        ++calls === 1
          ? { data: [{ _id: 'a' }], hasMore: true, nextCursor: 'next' }
          : {
              data: [{ _id: 'a', title: 'Updated' }, { _id: 'b' }],
              hasMore: false,
              nextCursor: null,
            },
      ),
  })
  assert.deepEqual(
    (await client.work.list()).map((row) => row._id),
    ['a', 'b'],
  )
  assert.equal(calls, 2)
  const stuck = createOverlayAppClient({
    fetch: async () => Response.json({ data: [], hasMore: true, nextCursor: 'same' }),
  })
  await assert.rejects(stuck.work.list(), /did not advance/)
})
