import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Computer } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { useAgentComputer } from './use-agent-computer'
import { isCurrentAgentComputerRequest } from './use-agent-computer'
import { useAgentSidebarComputer } from './use-agent-sidebar-computer'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function renderAccess(state: ReturnType<typeof useAgentComputer>) {
  let result: ReturnType<typeof useAgentSidebarComputer> | undefined
  function Probe() {
    // eslint-disable-next-line react-hooks/globals -- This SSR-only test captures the hook result without a client renderer.
    result = useAgentSidebarComputer({
      activeWorkspaceId: 'workspace', agentId: 'agent', enabled: true, visible: true,
      currentUserId: state.currentUserId, state,
    })
    return null
  }
  renderToStaticMarkup(<Probe />)
  assert.ok(result)
  return result
}

const computerFixture = (status: Computer['status']): Computer => ({
  id: 'computer',
  workspaceId: 'workspace',
  ownerType: 'agent',
  ownerId: 'agent',
  provider: 'box',
  providerRef: 'box-ref',
  size: 'default',
  status,
  name: 'Agent computer',
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 1,
  lastActiveAt: null,
})

test('Computer tab reads the same machine, loading and error state as Details', () => {
  const state = {
    agentComputer: computerFixture('stopped'),
    currentUserId: 'user',
    initialLoading: false,
    computerLoadError: null,
    retryComputerLoad: () => {},
  } as ReturnType<typeof useAgentComputer>
  assert.equal(renderAccess(state).computer, state.agentComputer)
  state.agentComputer = computerFixture('ready')
  assert.equal(renderAccess(state).computer, state.agentComputer)
  state.agentComputer = null
  assert.equal(renderAccess(state).computer, null)
  state.initialLoading = true
  assert.equal(renderAccess(state).computerLoading, true)
  state.computerLoadError = 'Cannot load'
  assert.equal(renderAccess(state).computerError, 'Cannot load')
})

test('Wake writes its actual response back to the Details computer state', async (t) => {
  const ready = computerFixture('ready')
  const updates: unknown[] = []
  let reloads = 0
  const state = {
    agentComputer: computerFixture('stopped'),
    currentUserId: 'user',
    initialLoading: false,
    computerLoadError: null,
    retryComputerLoad: () => { reloads++ },
    setAgentComputer: (next: unknown) => updates.push(next),
  } as unknown as ReturnType<typeof useAgentComputer>
  t.mock.method(overlayAppClient.computers, 'start', async (workspaceId: string, computerId: string) => {
    assert.equal(workspaceId, 'workspace')
    assert.equal(computerId, 'computer')
    return { computer: ready }
  })
  const access = renderAccess(state)
  await access.wake()
  assert.deepEqual(updates, [ready])
  access.loadComputer()
  assert.equal(reloads, 1)
})

test('shared computer updates reject stale workspace and generation responses', () => {
  assert.equal(isCurrentAgentComputerRequest('workspace:agent-a', 'workspace:agent-a', 4, 4), true)
  assert.equal(isCurrentAgentComputerRequest('workspace:agent-b', 'workspace:agent-a', 5, 4), false)
  assert.equal(isCurrentAgentComputerRequest('workspace:agent-a', 'workspace:agent-a', 5, 4), false)
})
