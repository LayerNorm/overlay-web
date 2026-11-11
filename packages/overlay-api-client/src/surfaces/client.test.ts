import assert from 'node:assert/strict'
import test from 'node:test'
import { SurfacesClient } from './client'
import { createHttpContext } from '../shared/http'

test('workspace Slack requests never choose an agent and use workspace headers and the existing DELETE endpoint', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const client = new SurfacesClient(createHttpContext({ fetch: async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ channels: [{ id: 'C1', name: 'general' }] }), { status: 200 })
  } }))
  await client.listBindings('ws')
  const channels = await client.listChannels('ws', 'connection/id')
  assert.deepEqual(channels.channels, [{ id: 'C1', name: 'general' }])
  await client.createBinding('ws', { connectionId: 'conn', channelId: 'C1', channelName: 'general' })
  await client.removeBinding('ws', 'binding/id')
  await client.disconnect('ws', 'connection/id')
  assert.equal(calls[0].url, '/api/v1/surfaces/bindings')
  assert.equal(calls[1].url, '/api/v1/surfaces/connections/connection%2Fid/channels')
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { connectionId: 'conn', channelId: 'C1', channelName: 'general' })
  assert.equal(calls[3].url, '/api/v1/surfaces/bindings/binding%2Fid')
  assert.equal(calls[3].init?.method, 'DELETE')
  assert.equal(calls[4].url, '/api/v1/surfaces/connections?connectionId=connection%2Fid')
  assert.equal(calls[4].init?.method, 'DELETE')
  for (const { url, init } of calls) {
    assert.equal(new Headers(init?.headers).get('x-overlay-workspace-id'), 'ws')
    assert.doesNotMatch(url, /agentId/)
    assert.doesNotMatch(String(init?.body), /agentId/)
  }
})

test('unlink sends only the current link scope and surfaces an error on rejection', async () => {
  let body: unknown
  const client = new SurfacesClient(createHttpContext({ fetch: async (_url, init) => {
    body = JSON.parse(String(init?.body))
    return new Response('forbidden', { status: 403 })
  } }))
  await assert.rejects(client.unlinkIdentity('ws', 'mine'), /Could not unlink your Slack account/)
  assert.deepEqual(body, { workspaceId: 'ws', linkId: 'mine' })
  const success = new SurfacesClient(createHttpContext({ fetch: async () => new Response('unlinked') }))
  await success.unlinkIdentity('ws', 'mine')
})
