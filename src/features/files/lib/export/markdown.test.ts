import assert from 'node:assert/strict'
import test from 'node:test'
import { chatMessagesToMarkdown } from './markdown'

test('Markdown export includes assistant text and handles empty chats and parts-only replies', () => {
  assert.equal(chatMessagesToMarkdown([]), '')
  assert.equal(chatMessagesToMarkdown([{ role: 'assistant', content: 'Content-only reply.' }]), '### Assistant\n\nContent-only reply.\n')
  assert.equal(chatMessagesToMarkdown([{ role: 'assistant', content: '', parts: [{ type: 'text', text: 'Parts-only reply.' }] }]), '### Assistant\n\nParts-only reply.\n')
})

test('Markdown export includes generated UI title and summary in order, never specs or bound state', () => {
  const card = { type: 'data', id: 'view', dataType: 'overlay.generated_ui', data: {
    version: 1, kind: 'json_render', catalogVersion: 1, title: 'Plan comparison', summary: 'Starter, Pro and Team plans.',
    specJson: 'SECRET_SPEC', stateJson: 'PRIVATE_FORM_STATE',
  } }
  const response = { role: 'assistant', content: 'Before the card.\nAfter the card.', parts: [
    { type: 'text', text: 'Before the card.' }, card, { type: 'text', text: 'After the card.' },
  ] }
  const markdown = chatMessagesToMarkdown([response])
  assert.ok(markdown.includes('Before the card.\n\n**Plan comparison**\nStarter, Pro and Team plans.\n\nAfter the card.'))
  assert.ok(!markdown.includes('SECRET_SPEC') && !markdown.includes('PRIVATE_FORM_STATE'))
  assert.ok(!markdown.includes('specJson') && !markdown.includes('stateJson'))
  assert.ok(chatMessagesToMarkdown([{ role: 'assistant', content: 'Content-only reply.', parts: [card] }]).includes('Content-only reply.'))
})
