import assert from 'node:assert/strict'
import test from 'node:test'
import { generatedUiDataToPlainText, normalizeGeneratedUiData } from './generated-ui'
import { generatedUiPartFromToolBlock } from './messages'
import { buildAssistantVisualSequence } from './visual-sequence'

const question = {
  version: 1,
  kind: 'questionnaire',
  prompt: 'What should we focus on?',
  choices: [{ id: 'research', label: 'Research' }, { id: 'planning', label: 'Planning' }],
  multiple: true,
}

test('questionnaires preserve stable IDs and render label snapshots as plain text', () => {
  const normalized = normalizeGeneratedUiData(question)
  assert.deepEqual(normalized, question)
  assert.equal(generatedUiDataToPlainText(normalized!), 'What should we focus on?\nResearch\nPlanning')
})

test('questionnaire tool results normalize into a generated UI transcript block', () => {
  const blocks = buildAssistantVisualSequence([{
    type: 'tool-present_generated_ui',
    toolCallId: 'questionnaire-call',
    state: 'output-available',
    input: question,
    output: { success: true, id: 'questionnaire-id', generatedUi: question },
  }])

  assert.equal(blocks[0]?.kind, 'generated-ui')
  if (blocks[0]?.kind !== 'generated-ui') assert.fail('Expected a generated UI block')
  assert.equal(blocks[0].part.id, 'questionnaire-call')
  assert.deepEqual(blocks[0].part.data, question)
})

test('questionnaires reject ambiguous or oversized model-authored choices', () => {
  assert.equal(normalizeGeneratedUiData({ ...question, prompt: ' ' }), null)
  assert.equal(normalizeGeneratedUiData({ ...question, choices: [question.choices[0], question.choices[0]] }), null)
  assert.equal(normalizeGeneratedUiData({ ...question, choices: [{ id: 'a', label: 'Same' }, { id: 'b', label: 'Same' }] }), null)
  assert.equal(normalizeGeneratedUiData({ ...question, choices: [{ id: 'a', label: 'x'.repeat(201) }] }), null)
  assert.equal(normalizeGeneratedUiData({ ...question, choices: Array.from({ length: 13 }, (_, i) => ({ id: `${i}`, label: `${i}` })) }), null)
})

test('render_ui tool blocks use the originating call ID while typed UI keeps its output ID', () => {
  const rendered = generatedUiPartFromToolBlock({
    key: 'render-call',
    name: 'render_ui',
    toolOutput: {
      success: true,
      id: 'content-hash',
      generatedUi: { version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Rendered',
        specJson: '{"root":"root","elements":{"root":{"type":"Text","props":{"text":"Rendered"}}}}' },
    },
  } as never)
  assert.equal(rendered?.id, 'render-call')

  const typed = generatedUiPartFromToolBlock({
    key: 'question-call',
    name: 'present_generated_ui',
    toolOutput: { success: true, id: 'question-hash', generatedUi: question },
  } as never)
  assert.equal(typed?.id, 'question-hash')
})
