import assert from 'node:assert/strict'
import test from 'node:test'
import { includedItemsOfMessage, includedItemsPrompt, MAX_INCLUDED_ITEMS, parseIncludedItems } from './included-items'

test('only notes, files and automations are included, once each, at most ten', () => {
  const mentions = [
    { type: 'person', id: 'p_1', name: 'Maya' },
    { type: 'file', id: 'f_1', name: 'Launch plan' },
    { type: 'file', id: 'f_1', name: 'Launch plan' },
    { type: 'automation', id: 'a_1', name: 'Weekly digest' },
    { type: 'skill', id: 's_1', name: 'Brief' },
    { type: 'file', id: '', name: 'blank' },
    'junk',
  ]
  assert.deepEqual(parseIncludedItems(mentions), [
    { type: 'file', id: 'f_1', name: 'Launch plan' },
    { type: 'automation', id: 'a_1', name: 'Weekly digest' },
  ])
  const many = Array.from({ length: 20 }, (_, i) => ({ type: 'file', id: `f_${i}`, name: `${i}` }))
  assert.equal(parseIncludedItems(many).length, MAX_INCLUDED_ITEMS)
  assert.deepEqual(parseIncludedItems(undefined), [])
})

test('an agent’s message never includes anything', () => {
  const includedItems = [{ type: 'file' as const, id: 'f_1', name: 'Plan' }]
  assert.deepEqual(includedItemsOfMessage({ authorKind: 'human', includedItems }), includedItems)
  assert.deepEqual(includedItemsOfMessage({ authorKind: 'agent', includedItems }), [])
  assert.deepEqual(includedItemsOfMessage(undefined), [])
})

test('the prompt names each included item, and is empty when there are none', () => {
  assert.equal(includedItemsPrompt([]), '')
  const prompt = includedItemsPrompt([{ type: 'file', id: 'f_1', name: 'Say "hi"' }])
  assert.match(prompt, /file id=f_1 name="Say 'hi'"/)
  assert.match(prompt, /everyone in this room will see your reply/)
})
