import assert from 'node:assert/strict'
import test from 'node:test'
import { createOverlayAppClient } from '@overlay/api-client'
import { readFileLinkChildren } from './file-markdown-links'

test('relative file metadata exhausts scoped parent pages through the normal authenticated API client', async () => {
  const urls: URL[] = [], signal = new AbortController().signal
  const client = createOverlayAppClient({ baseUrl: 'https://app.test', getAuthHeaders: () => ({ 'x-overlay-workspace-id': 'workspace-fixture' }), fetch: async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    urls.push(url)
    assert.equal(init?.signal, signal)
    assert.equal(new Headers(init?.headers).get('x-overlay-workspace-id'), 'workspace-fixture')
    return Response.json({ data: [{ _id: urls.length === 1 ? 'guide' : 'index', name: 'File.md', type: 'file', parentId: 'task', userId: 'owner' }],
      hasMore: urls.length === 1, nextCursor: urls.length === 1 ? 'next-page' : undefined })
  } })
  const rows = await readFileLinkChildren({ parentId: 'task', scope: 'personal', signal, files: client.files })
  assert.deepEqual(rows.map(row => row._id), ['guide', 'index'])
  for (const url of urls) {
    assert.equal(url.pathname, '/api/v1/files')
    assert.equal(url.searchParams.get('view'), 'personal')
    assert.equal(url.searchParams.get('parentId'), 'task')
    assert.equal(url.searchParams.get('page'), 'true')
    assert.equal(url.searchParams.get('summary'), 'true')
  }
  assert.equal(urls[1]?.searchParams.get('cursor'), 'next-page')
})

test('incomplete or inconsistent listings cannot produce a guessed link', async () => {
  for (const body of [{ data: [], hasMore: true }, {
    data: [{ _id: 'one', id: 'different', name: 'File.md', type: 'file', parentId: null }], hasMore: false,
  }]) {
    const client = createOverlayAppClient({ baseUrl: 'https://app.test', fetch: async () => Response.json(body) })
    await assert.rejects(readFileLinkChildren({ parentId: null, scope: 'workspace', signal: new AbortController().signal, files: client.files }))
  }
})
