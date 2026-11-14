import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLatestActivityWithMainFallback, startAgentChat } from './agent-chat'

const threadArgs = { workspaceId: 'workspace-1', agentId: 'agent-1' }
const latestThread = { conversationId: 'conversation-latest', title: 'Latest thread' }
const mainThread = { conversationId: 'conversation-main', title: 'Main thread' }

test('latest activity resolver wins without calling main resolver', async () => {
  let mainCalls = 0

  const result = await resolveLatestActivityWithMainFallback(
    threadArgs,
    async (args) => {
      assert.deepEqual(args, threadArgs)
      return latestThread
    },
    async () => {
      mainCalls += 1
      return mainThread
    },
  )

  assert.deepEqual(result, latestThread)
  assert.equal(mainCalls, 0)
})

test('missing exact latest-activity public mutation falls back to main resolver', async () => {
  for (const message of [
    "Could not find public function for 'agents/threads:resolveLatestActivity'",
    'No function found for agents/threads:resolveLatestActivity.',
  ]) {
    let mainCalls = 0

    const result = await resolveLatestActivityWithMainFallback(
      threadArgs,
      async () => { throw new Error(message) },
      async (args) => {
        mainCalls += 1
        assert.deepEqual(args, threadArgs)
        return mainThread
      },
    )

    assert.deepEqual(result, mainThread)
    assert.equal(mainCalls, 1)
  }
})

test('wrong or near-match missing-function paths do not fall back', async (t) => {
  for (const message of [
    "Could not find public function for 'agents/threads:resolveMain'",
    "Could not find public function for 'agents/threads:resolveLatestActivityExtra'",
    "Could not find public function for 'agents/threads:resolveLatestActivity.extra'",
    "Could not find public function for 'agents/threads.resolveLatestActivity'",
  ]) {
    await t.test(message, async () => {
      const error = new Error(message)
      let mainCalls = 0

      await assert.rejects(
        resolveLatestActivityWithMainFallback(
          threadArgs,
          async () => { throw error },
          async () => {
            mainCalls += 1
            return mainThread
          },
        ),
        (actual) => actual === error,
      )
      assert.equal(mainCalls, 0)
    })
  }
})

test('authorization, validation, and transport errors do not fall back', async (t) => {
  for (const error of [
    new Error('Unauthorized'),
    new Error('ArgumentValidationError: invalid workspaceId'),
    new TypeError('Failed to fetch'),
  ]) {
    await t.test(error.message, async () => {
      let mainCalls = 0

      await assert.rejects(
        resolveLatestActivityWithMainFallback(
          threadArgs,
          async () => { throw error },
          async () => {
            mainCalls += 1
            return mainThread
          },
        ),
        (actual) => actual === error,
      )
      assert.equal(mainCalls, 0)
    })
  }
})

test('fallback resolver errors propagate unchanged', async () => {
  const fallbackError = new Error('WORKSPACE_ACCESS_DENIED')

  await assert.rejects(
    resolveLatestActivityWithMainFallback(
      threadArgs,
      async () => { throw new Error("Could not find public function for 'agents/threads:resolveLatestActivity'") },
      async () => { throw fallbackError },
    ),
    (actual) => actual === fallbackError,
  )
})

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
  const savedAt = 1_000
  t.mock.method(Date, 'now', () => savedAt)
  let pendingAtNavigation: string | undefined

  const conversationId = await startAgentChat({
    workspaceId: 'workspace-1',
    agentId: 'agent-1',
    agentPrincipalId: 'agent-principal-1',
    initialMessage: '  Follow these instructions  ',
    surface: 'agents',
    resolveAgentThread: async () => ({ conversationId: 'conversation-new-agent', title: 'New thread' }),
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
