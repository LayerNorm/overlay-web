import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Computer } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { useAgentComputer } from './use-agent-computer'
import { useAgentSidebarComputer } from './use-agent-sidebar-computer'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function renderAccess(state: ReturnType<typeof useAgentComputer>) {
  let result: ReturnType<typeof useAgentSidebarComputer> | undefined
  function Probe() {
    // eslint-disable-next-line react-hooks/globals -- This SSR-only test captures the hook result without a client renderer.
    result = useAgentSidebarComputer({
      activeWorkspaceId: 'workspace', agentId: 'agent', enabled: true, visible: true, state,
    })
    return null
  }
  renderToStaticMarkup(<Probe />)
  assert.ok(result)
  return result
}

test('Computer tab reads the same machine, loading and error state as Details', () => {
  const state = {
    agentComputer: { id: 'computer', status: 'stopped' },
    initialLoading: false,
    computerLoadError: null,
    retryComputerLoad: () => {},
  } as ReturnType<typeof useAgentComputer>
  assert.equal(renderAccess(state).computer, state.agentComputer)
  state.agentComputer = { id: 'computer', status: 'ready' } as Computer
  assert.equal(renderAccess(state).computer, state.agentComputer)
  state.agentComputer = null
  assert.equal(renderAccess(state).computer, null)
  state.initialLoading = true
  assert.equal(renderAccess(state).computerLoading, true)
  state.computerLoadError = 'Cannot load'
  assert.equal(renderAccess(state).computerError, 'Cannot load')
})

test('Wake writes its actual response back to the Details computer state', async (t) => {
  const ready = { id: 'computer', status: 'ready' } as Computer
  const updates: unknown[] = []
  let reloads = 0
  const state = {
    agentComputer: { id: 'computer', status: 'stopped' },
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
