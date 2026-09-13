import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAssistantVisualSegments,
  planAssistantWorkCollapse,
} from './messages'
import type { AssistantVisualBlock } from './types'

const tool = (name: string, toolOutput?: unknown): AssistantVisualBlock => ({
  kind: 'tool',
  key: `k-${name}`,
  name,
  state: 'output-available',
  toolInput: {},
  toolOutput,
})
const reasoning = (text: string): AssistantVisualBlock => ({
  kind: 'reasoning', key: `r-${text}`, text, state: 'done',
})
const text = (value: string): AssistantVisualBlock => ({ kind: 'text', text: value })

test('all work collapses into one set; every text stays visible in order', () => {
  const segments = buildAssistantVisualSegments([
    reasoning('thinking'),
    tool('search_knowledge'),
    text('interim note'),
    tool('save_memory'),
    text('Final answer.'),
  ])
  const plan = planAssistantWorkCollapse(segments)
  // reasoning + both tools fold behind the single row; both texts keep
  // rendering where they were written.
  assert.deepEqual(plan.collapsedIndexes, [0, 1, 3])
  assert.equal(plan.collapsedToolCallCount, 2)
  assert.equal(segments[2]!.kind, 'text')
  assert.equal(segments[4]!.kind, 'text')
})

test('keeps deliverable segments inline while work around them collapses', () => {
  const segments = buildAssistantVisualSegments([
    tool('search_knowledge'),
    { kind: 'file', url: 'https://example.com/img.png', mediaType: 'image/png' },
    tool('draft_skill_from_chat', { success: true, draft: { name: 'S', description: '', reason: '' } }),
    text('Done.'),
  ])
  const plan = planAssistantWorkCollapse(segments)
  // Only the leading tool collapses; the file and draft card stay visible.
  assert.deepEqual(plan.collapsedIndexes, [0])
  assert.equal(plan.collapsedToolCallCount, 1)
})

test('a gated plan callout stays inline rather than hiding in the row', () => {
  // A file segment splits the tools so the gated callout is its own
  // single-tool segment — which is when it renders as the callout.
  const segments = buildAssistantVisualSegments([
    tool('save_memory'),
    { kind: 'file', url: 'https://example.com/a.png', mediaType: 'image/png' },
    tool('generate_video', {
      _overlayGatedFeature: true, feature: 'deep_research', message: 'Paid only.',
    }),
    text('Could not do that on this plan.'),
  ])
  const plan = planAssistantWorkCollapse(segments)
  // save_memory collapses; the file and the gated callout stay inline.
  assert.deepEqual(plan.collapsedIndexes, [0])
  assert.equal(segments[2]!.kind, 'tools')
})

test('a pure-text message produces no collapse row', () => {
  const segments = buildAssistantVisualSegments([
    text('First'), text('Second'),
  ])
  const plan = planAssistantWorkCollapse(segments)
  assert.deepEqual(plan.collapsedIndexes, [])
  assert.equal(plan.collapsedToolCallCount, 0)
})

test('with no text the whole turn still collapses behind the one row', () => {
  const segments = buildAssistantVisualSegments([
    reasoning('thinking'),
    tool('search_knowledge'),
    tool('list_notes'),
  ])
  const plan = planAssistantWorkCollapse(segments)
  assert.deepEqual(plan.collapsedIndexes, [0, 1])
  assert.equal(plan.collapsedToolCallCount, 2)
})

test('work after the final text joins the same collapsed set', () => {
  const segments = buildAssistantVisualSegments([
    tool('search_knowledge'),
    text('answer'),
    tool('save_memory'),
  ])
  const plan = planAssistantWorkCollapse(segments)
  assert.deepEqual(plan.collapsedIndexes, [0, 2])
  assert.equal(plan.collapsedToolCallCount, 2)
})

test('a full answer before a trailing tool call is not hidden by the close-out text', () => {
  // The reported bug: text → tool → short text used to fold the answer into
  // the collapse and only the last line rendered.
  const segments = buildAssistantVisualSegments([
    text('The complete fundraising answer.'),
    tool('save_memory'),
    text('Answered above — happy to go deeper.'),
  ])
  const plan = planAssistantWorkCollapse(segments)
  assert.deepEqual(plan.collapsedIndexes, [1])
})
