import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { measureInteraction, openIndependentClients, previewOrigin, previewPath, matchesConversationMutation } from './realtime-baseline.mjs'

test('only canonical isolated preview origins and relative paths are accepted', () => {
  assert.equal(previewOrigin('https://pr-123.preview.getoverlay.io/'), 'https://pr-123.preview.getoverlay.io')
  for (const origin of ['https://getoverlay.io', 'https://pr-1.preview.getoverlay.io.evil.com',
    'http://pr-1.preview.getoverlay.io', 'https://pr-1.preview.getoverlay.io:8443',
    'https://user:secret@pr-1.preview.getoverlay.io', 'https://pr-1.preview.getoverlay.io/?token=secret']) {
    assert.throws(() => previewOrigin(origin))
  }
  assert.equal(previewPath('/app/chat?id=fixture'), '/app/chat?id=fixture')
  for (const path of ['https://getoverlay.io', '//getoverlay.io', '/\\getoverlay.io', '/\n/getoverlay.io', undefined]) {
    assert.throws(() => previewPath(path))
  }
})

test('observers are armed before the action and durations share one clock', async () => {
  let clock = 100
  const resolve = {}
  const observers = Object.fromEntries(['localFeedback', 'mutationAcknowledged', 'remoteVisible'].map((stage) => [
    stage, () => new Promise((done) => { resolve[stage] = done }),
  ]))
  const sample = await measureInteraction({
    now: () => clock,
    observers,
    trigger: async () => {
      assert.equal(Object.keys(resolve).length, 3)
      clock = 110
      resolve.localFeedback()
      await Promise.resolve()
      clock = 140
      resolve.mutationAcknowledged()
      await Promise.resolve()
      clock = 175
      resolve.remoteVisible()
    },
  })
  assert.deepEqual(sample, { action: 'completed', stages: {
    localFeedback: { status: 'observed', ms: 10 },
    mutationAcknowledged: { status: 'observed', ms: 40 },
    remoteVisible: { status: 'observed', ms: 75 },
  } })
})

test('unavailable, timeout, already-satisfied, and failed actions never become zero latency success', async () => {
  const sample = await measureInteraction({
    trigger: () => { throw new Error('private page text') },
    observers: {
      localFeedback: () => Promise.resolve(),
      remoteVisible: () => Promise.reject(new Error('private selector')),
    },
  })
  assert.deepEqual(sample, { action: 'failed', stages: {
    localFeedback: { status: 'invalid-precondition', ms: null },
    mutationAcknowledged: { status: 'unavailable', ms: null },
    remoteVisible: { status: 'not-observed', ms: null },
  } })
  assert.ok(!JSON.stringify(sample).includes('private'))
})

test('clients use separate contexts, not two pages sharing local storage', async () => {
  const contexts = []
  const browser = { async newContext() {
    const context = {
      closed: false,
      async addInitScript() {},
      async newPage() { return {
        async goto(url) { this.destination = url },
        async waitForFunction() {},
        url() { return this.destination },
      } },
      async close() { this.closed = true },
    }
    contexts.push(context)
    return context
  } }
  const clients = await openIndependentClients(browser, {
    origin: 'https://pr-123.preview.getoverlay.io', path: '/app/chat', storageState: { cookies: [], origins: [] },
  })
  assert.equal(contexts.length, 2)
  assert.notEqual(clients.pages[0], clients.pages[1])
  await clients.close()
  assert.ok(contexts.every((context) => context.closed))
})

test('navigation stages preserve read and rendered-content timing separately', async () => {
  let clock = 0
  let feedback
  let read
  let content
  const sample = await measureInteraction({
    stages: ['localFeedback', 'readAcknowledged', 'contentVisible'],
    now: () => clock,
    observers: {
      localFeedback: () => new Promise(resolve => { feedback = resolve }),
      readAcknowledged: () => new Promise(resolve => { read = resolve }),
      contentVisible: () => new Promise(resolve => { content = resolve }),
    },
    trigger: async () => {
      clock = 5; feedback(); await Promise.resolve()
      clock = 30; read(); await Promise.resolve()
      clock = 45; content()
    },
  })
  assert.deepEqual(sample.stages, {
    localFeedback: { status: 'observed', ms: 5 },
    readAcknowledged: { status: 'observed', ms: 30 },
    contentVisible: { status: 'observed', ms: 45 },
  })
})

test('mutation acknowledgements exclude other chats, read cursors and failed writes', () => {
  const origin = 'https://pr-392.preview.getoverlay.io'
  const response = (path, body, ok = true) => ({
    url: () => origin + path, ok: () => ok,
    request: () => ({ method: () => 'PATCH', postDataJSON: () => body }),
  })
  const rename = { origin, conversationId: 'fixture', title: 'CN01 QA renamed' }
  assert.equal(matchesConversationMutation(response('/api/v1/conversations', { conversationId: 'fixture', title: rename.title }), rename), true)
  assert.equal(matchesConversationMutation(response('/api/v1/conversations', { conversationId: 'other', title: rename.title }), rename), false)
  assert.equal(matchesConversationMutation(response('/api/v1/conversations', { conversationId: 'fixture', title: 'old' }), rename), false)
  const archive = { origin, conversationId: 'fixture', archived: true }
  const path = '/api/v1/conversations/fixture/state'
  assert.equal(matchesConversationMutation(response(path, { archived: true }), archive), true)
  assert.equal(matchesConversationMutation(response(path, { lastReadAt: 123 }), archive), false)
  assert.equal(matchesConversationMutation(response(path, { archived: false }), archive), false)
  assert.equal(matchesConversationMutation(response('/api/v1/conversations/other/state', { archived: true }), archive), false)
  assert.equal(matchesConversationMutation(response(path, { archived: true }, false), archive), false)
  assert.equal(matchesConversationMutation({ ...response(path, {}), request() { throw Error('private request') } }, archive), false)
})

test('runner setup failures do not print invalid configuration or storage-state paths', () => {
  const privateValue = 'private-baseline-fixture-secret'
  const common = { CN01_CHAT_PATH: '/app/chat?id=fixture', CN01_PREVIEW_SHA: 'a'.repeat(40) }
  for (const env of [
    { ...common, CN01_PREVIEW_ORIGIN: privateValue },
    { ...common, CN01_PREVIEW_ORIGIN: 'https://pr-392.preview.getoverlay.io', CN01_STORAGE_STATE: `/nonexistent/${privateValue}` },
    { ...common, CN01_PREVIEW_ORIGIN: 'https://pr-392.preview.getoverlay.io', CN01_PREVIEW_SHA: privateValue },
  ]) {
    const result = spawnSync(process.execPath, ['scripts/qa/personal-chat-realtime.mjs'], { env, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.ok(!`${result.stdout}${result.stderr}`.includes(privateValue))
    assert.deepEqual(JSON.parse(result.stdout), { ...(env.CN01_PREVIEW_SHA === common.CN01_PREVIEW_SHA
      && env.CN01_PREVIEW_ORIGIN.startsWith('https:') ? { revision: common.CN01_PREVIEW_SHA } : {}),
      status: 'no-sample', phase: 'configuration' })
  }
})
