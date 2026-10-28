import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { startAgentChat } from './agent-chat'

test('startAgentChat stores initial instructions before navigation', async (t) => {
  const values = new Map<string, string>()
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => { values.delete(key) },
      },
      dispatchEvent: () => true,
    },
  })
  t.after(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  })
  t.mock.method(overlayAppClient.agents, 'resolveMainThread', async () => ({
    thread: { conversationId: 'conversation-new-agent', title: 'New thread' },
  }))
  let pendingAtNavigation: string | undefined

  const conversationId = await startAgentChat({
    workspaceId: 'workspace-1',
    agentId: 'agent-1',
    agentPrincipalId: 'agent-principal-1',
    initialMessage: '  Follow these instructions  ',
    surface: 'agents',
    push: () => {
      pendingAtNavigation = values.get('overlay:pending-collaboration-message')
    },
  })

  assert.equal(conversationId, 'conversation-new-agent')
  assert.deepEqual(JSON.parse(pendingAtNavigation ?? 'null'), {
    conversationId: 'conversation-new-agent',
    content: '  Follow these instructions  ',
    expectedAgentPrincipalId: 'agent-principal-1',
  })
})
