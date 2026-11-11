import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Spec } from '@json-render/core'
import { buildGenerativeUiCatalogPrompt } from '@overlay/chat-core/generative-ui'
import { buildAssistantVisualSequence } from '@overlay/chat-core'
import { isGeneratedUiPart } from '@overlay/chat-core/generated-ui'
import { JsonRenderCard } from '@overlay/chat-react/json-render-card'
import { GeneratedUiCard } from '@overlay/chat-react/generated-ui-card'
import { buildAssistantPersistenceFromSteps } from '@/shared/chat/persist-assistant-turn'
import { executeRenderUi } from './overlay-executes'

const renderOptions = { userId: 'user-test', serverSecret: 'secret-test', baseUrl: 'http://localhost:3000' }

function formSpec(): Spec {
  const example = buildGenerativeUiCatalogPrompt().split('\n').find(line => line.startsWith('Form example: '))
  assert.ok(example)
  return JSON.parse(example.slice('Form example: '.length))
}

function uiStep(toolCallId: string, toolName: string, output: unknown) {
  const call = { type: 'tool-call', toolCallId, toolName, input: {} }
  const result = { type: 'tool-result', toolCallId, toolName, input: {}, output }
  return { text: '', content: [call, result], toolCalls: [call], toolResults: [result] }
}

test('realistic bug forms execute, persist and render with nested bindings, extra props and misplaced children', async () => {
  const variants: Array<[string, (spec: Spec) => void]> = [
    ['canonical form', () => {}],
    ['field name', spec => { spec.elements.title!.props.name = 'title' }],
    ['button variant', spec => { spec.elements.submit!.props.variant = 'default' }],
    ['empty leaf children', spec => { for (const element of Object.values(spec.elements)) element.children ??= [] }],
    ['children in props', spec => {
      for (const id of ['card', 'fields']) {
        const element = spec.elements[id]!
        element.props.children = element.children
        delete element.children
      }
    }],
  ]
  for (const [name, mutate] of variants) {
    const spec = formSpec()
    spec.state = { form: { title: 'Sidebar disappears', details: 'Open a thread', severity: 'High', reproducible: true, frequency: 'Always' } }
    mutate(spec)
    const output = await executeRenderUi(renderOptions, { title: '  Bug report  ', summary: '  Complete the bug report.  ', spec })
    assert.equal(output.success, true, name)
    if (!output.success) continue
    const persistence = buildAssistantPersistenceFromSteps([uiStep('form', 'render_ui', output)] as never, '')
    const part = persistence.parts.find(isGeneratedUiPart)
    assert.ok(part, name)
    assert.equal(part.data.kind, 'json_render')
    if (part.data.kind !== 'json_render') continue
    const normalized = JSON.parse(part.data.specJson) as Spec
    assert.equal(Object.hasOwn(normalized.elements.title!.props, 'name'), false)
    assert.equal(Object.hasOwn(normalized.elements.submit!.props, 'variant'), false)
    assert.deepEqual(normalized.elements.card!.children, ['fields'])
    const html = renderToStaticMarkup(createElement(JsonRenderCard, { partId: part.id, data: part.data }))
    for (const expected of ['<input', '<textarea', 'role="combobox"', 'role="checkbox"', 'role="radiogroup"', 'Sidebar disappears', 'Submit bug report']) {
      assert.ok(html.includes(expected), `${name}: ${expected}`)
    }
    assert.ok(!html.includes('Could not display this view'), name)
  }
})

test('failed render_ui specs leave an error trace and actionable retry instructions, never a phantom card', async () => {
  const spec = formSpec()
  spec.elements.submit!.on = { press: { action: 'submit', params: { state: { $state: '/form' } } } }
  const output = await executeRenderUi(renderOptions, { summary: 'Bug report', spec })
  assert.equal(output.success, false)
  if (output.success) return
  assert.match(output.error, /No UI was created/)
  assert.match(output.hint, /Fix the listed issues and call render_ui again/)
  assert.match(output.hint, /Only claim a view was displayed after success:true/)
  assert.match(output.hint, /tell the user plainly that you could not display it/)
  const persistence = buildAssistantPersistenceFromSteps([uiStep('failed', 'render_ui', output)] as never, '')
  assert.ok(!persistence.parts.some(isGeneratedUiPart))
  const blocks = buildAssistantVisualSequence(persistence.parts)
  assert.equal(blocks[0]?.kind, 'tool')
  if (blocks[0]?.kind === 'tool') assert.equal(blocks[0].state, 'output-error')
})

test('typed questionnaires survive persistence and render their choices', () => {
  const generatedUi = { version: 1, kind: 'questionnaire', prompt: 'Which QA environment?',
    choices: [{ id: 'preview', label: 'Preview' }, { id: 'production', label: 'Production' }], multiple: false }
  const output = { success: true, id: 'question', generatedUi }
  const persistence = buildAssistantPersistenceFromSteps([uiStep('question', 'present_generated_ui', output)] as never, '')
  const part = persistence.parts.find(isGeneratedUiPart)
  assert.ok(part)
  const html = renderToStaticMarkup(createElement(GeneratedUiCard, { part }))
  assert.ok(html.includes('Which QA environment?'))
  assert.ok(html.includes('Preview') && html.includes('Production'))
})
