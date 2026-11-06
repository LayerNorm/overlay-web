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
  const savedAt = 1_000
  t.mock.method(Date, 'now', () => savedAt)
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
    savedAt,
  })
})

test('native start renders the destination before resolution and never downloads an HTTP bundle or resolver', async (t) => {
  const legacy = t.mock.method(overlayAppClient.agents, 'resolveMainThread', async () => { throw new Error('Legacy resolver called') })
  const urls: string[] = []
  const replaced: string[] = []
  let finish!: (thread: { conversationId: string; title: string }) => void
  const resolving = new Promise<{ conversationId: string; title: string }>(resolve => { finish = resolve })
  const started = startAgentChat({ workspaceId: 'workspace', agentId: 'agent', agentPrincipalId: 'agent-p', surface: 'agents',
    nativeThreads: { enabled: true, resolve: () => resolving }, push: href => { urls.push(href) }, replace: href => { replaced.push(href) } })
  assert.equal(urls.length, 1)
  assert.match(urls[0], /nativePending=/)
  assert.equal(new URL(urls[0], 'https://test.invalid').searchParams.has('id'), false)
  finish({ conversationId: 'native-thread', title: 'Native' })
  assert.equal(await started, 'native-thread')
  assert.equal(urls.length, 1)
  assert.match(replaced[0], /id=native-thread/)
  assert.equal(legacy.mock.callCount(), 0)
})

test('native resolver failure exits pending state without silently using legacy', async (t) => {
  const legacy = t.mock.method(overlayAppClient.agents, 'resolveMainThread', async () => { throw new Error('Legacy resolver called') })
  const urls: string[] = []
  await assert.rejects(startAgentChat({ workspaceId: 'workspace', agentId: 'agent', agentPrincipalId: 'agent-p', surface: 'agents',
    nativeThreads: { enabled: true, resolve: async () => { throw new Error('Native unavailable') } }, push: href => { urls.push(href) } }), /Native unavailable/)
  assert.match(urls[0], /nativePending=/)
  assert.match(urls[1], /nativeError=1/)
  assert.doesNotMatch(urls[1], /nativePending=/)
  assert.equal(legacy.mock.callCount(), 0)
})

test('pending creation recovery replays the same request id rather than resolving another main', async () => {
  const urls: string[] = []
  const requests: string[] = []
  const conversationId = await startAgentChat({ workspaceId: 'workspace', agentId: 'agent', agentPrincipalId: 'agent-p', surface: 'agents', feedback: false,
    nativeRequestId: 'original-request', recoverPending: true, nativeThreads: { enabled: true,
      resolve: async () => { throw new Error('Unexpected main resolution') },
      create: async (_agentId, requestId) => { requests.push(requestId); return { conversationId: 'created-thread', title: 'Created' } } }, push: href => { urls.push(href) } })
  assert.equal(conversationId, 'created-thread')
  assert.deepEqual(requests, ['original-request'])
  assert.match(urls[0], /id=created-thread/)
})
