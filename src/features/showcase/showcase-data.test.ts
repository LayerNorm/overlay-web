import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SHOWCASE_AUTOMATIONS,
  SHOWCASE_CONNECTORS,
  SHOWCASE_CONVERSATIONS,
  SHOWCASE_FILES,
  SHOWCASE_MCPS,
  SHOWCASE_PROJECTS,
  SHOWCASE_SKILLS,
  SHOWCASE_CHAT_SNAPSHOTS,
  SHOWCASE_CHAT_SUMMARIES,
  SHOWCASE_KNOWLEDGE_NODES,
} from './showcase-data'

test('public workspace has a deterministic outcome-led seed', () => {
  assert.equal(SHOWCASE_CONVERSATIONS.length, 6)
  assert.equal(SHOWCASE_PROJECTS.length, 2)
  assert.equal(SHOWCASE_AUTOMATIONS.length, 3)
  assert.ok(SHOWCASE_CONNECTORS.some((connector) => connector.isConnected))
  assert.ok(SHOWCASE_CONNECTORS.some((connector) => !connector.isConnected))
  assert.ok(SHOWCASE_SKILLS.length >= 3)
  assert.ok(SHOWCASE_MCPS.length >= 2)

  const conversationIds = SHOWCASE_CONVERSATIONS.map((conversation) => conversation.id)
  const fileIds = SHOWCASE_FILES.map((file) => file.id)
  assert.equal(new Set(conversationIds).size, conversationIds.length)
  assert.equal(new Set(fileIds).size, fileIds.length)
  assert.equal(SHOWCASE_CHAT_SUMMARIES.length, SHOWCASE_CONVERSATIONS.length)
  assert.equal(Object.keys(SHOWCASE_CHAT_SNAPSHOTS).length, SHOWCASE_CONVERSATIONS.length)
  assert.equal(SHOWCASE_KNOWLEDGE_NODES.length, SHOWCASE_FILES.length)
})

test('seeded files exercise every promised viewer family', () => {
  const extensions = new Set(SHOWCASE_FILES.map((file) => file.name.split('.').pop()?.toLowerCase()))
  for (const extension of ['md', 'txt', 'csv', 'pdf', 'docx', 'xlsx', 'html', 'svg', 'wav', 'mp4']) {
    assert.ok(extensions.has(extension), `missing .${extension} showcase file`)
  }
})

test('seeded conversations cover the primary product outcomes', () => {
  const corpus = SHOWCASE_CONVERSATIONS.map((conversation) => `${conversation.eyebrow} ${conversation.messages.map((message) => message.text).join(' ')}`).join(' ').toLowerCase()
  for (const capability of ['search the web', 'memory', 'files', 'connectors', 'sandbox', 'images', 'video', 'automations']) {
    assert.match(corpus, new RegExp(capability))
  }
})
