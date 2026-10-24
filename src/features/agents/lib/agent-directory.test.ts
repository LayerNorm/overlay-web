import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { WorkspaceAgentDirectoryItem, WorkspaceAgentListResponse } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { AGENT_DIRECTORY_CHANGED_EVENT } from '@/shared/workspace/sidebar-events'
import { subscribeAgentDirectory, type AgentDirectoryState } from './agent-directory'

function response(ids: string[]): WorkspaceAgentListResponse {
  return {
    agents: ids.map((id) => ({ id }) as WorkspaceAgentDirectoryItem),
    viewerPrincipalId: 'viewer',
    canCreate: true,
  }
}

function changed(events: EventTarget, workspaceId: string) {
  events.dispatchEvent(new CustomEvent(AGENT_DIRECTORY_CHANGED_EVENT, { detail: { workspaceId } }))
}

test('a mounted directory refreshes after creation and archive without a reload', async (t) => {
  const events = new EventTarget()
  const states: AgentDirectoryState[] = []
  let agents = ['existing']
  let requests = 0
  t.mock.method(overlayAppClient.agents, 'list', async (workspaceId: string) => {
    assert.equal(workspaceId, 'personal')
    requests++
    return response(agents)
  })
  const dispose = subscribeAgentDirectory('personal', (state) => states.push(state), events)
  t.after(dispose)
  await setImmediate()
  assert.deepEqual(states.at(-1)?.agents?.map((agent) => agent.id), ['existing'])
  changed(events, 'other-workspace')
  assert.equal(requests, 1)

  agents = ['existing', 'created']
  changed(events, 'personal')
  assert.equal(states.at(-1)?.agents, null, 'show pending, not unavailable, while refreshing')
  await setImmediate()
  assert.deepEqual(states.at(-1)?.agents?.map((agent) => agent.id), agents)
  assert.equal(states.at(-1)?.viewerPrincipalId, 'viewer')

  agents = ['existing']
  changed(events, 'personal')
  await setImmediate()
  assert.deepEqual(states.at(-1)?.agents?.map((agent) => agent.id), agents)
  dispose()
  changed(events, 'personal')
  assert.equal(requests, 3)
})

test('older successes or errors cannot replace a refreshed roster and disposed requests cannot publish', async (t) => {
  const events = new EventTarget()
  const states: AgentDirectoryState[] = []
  const pending: Array<ReturnType<typeof Promise.withResolvers<WorkspaceAgentListResponse>>> = []
  t.mock.method(overlayAppClient.agents, 'list', () => {
    const request = Promise.withResolvers<WorkspaceAgentListResponse>()
    pending.push(request)
    return request.promise
  })
  const dispose = subscribeAgentDirectory('workspace', (state) => states.push(state), events)
  t.after(dispose)
  changed(events, 'workspace')
  changed(events, 'workspace')
  pending[2].resolve(response(['created']))
  await setImmediate()
  const latest = states.at(-1)
  pending[0].resolve(response([]))
  pending[1].reject(new Error('stale failure'))
  await setImmediate()
  assert.equal(states.at(-1), latest)
  assert.deepEqual(latest?.agents?.map((agent) => agent.id), ['created'])

  changed(events, 'workspace')
  const beforeDispose = states.length
  dispose()
  pending[3].resolve(response(['late']))
  changed(events, 'workspace')
  await setImmediate()
  assert.equal(states.length, beforeDispose)
  assert.equal(pending.length, 4)
})
