import { describe, expect, it } from 'vitest'
import type { ConversationMessagePart } from '../../overlay-app-core/src/contracts/conversations'
import { buildGeneratedUiPart, generatedUiDataToPlainText, generatedUiDeliveryText, isGeneratedUiPart, mergeJsonRenderState, normalizeGeneratedUiData } from './generated-ui'

const data = {
  version: 1 as const, kind: 'json_render' as const, catalogVersion: 1,
  summary: 'Bug report', title: 'Report',
  specJson: JSON.stringify({ root: 'input', elements: { input: { type: 'Input', props: { label: 'Title', value: { $bindState: '/title' } } } } }),
  stateJson: JSON.stringify({ title: 'A bug', price: '$1,200' }), submittedAt: 123,
}

it('updates only valid bounded state and makes submission immutable and idempotent', () => {
  const current = { ...data, submittedAt: undefined }
  const saved = mergeJsonRenderState(current, { ...current, stateJson: '{"title":"New"}' })
  expect(saved.specJson).toBe(data.specJson)
  expect(saved.stateJson).toBe('{"title":"New"}')
  const submitted = mergeJsonRenderState(saved, { ...saved, submittedAt: 42 })
  expect(mergeJsonRenderState(submitted, submitted)).toEqual(submitted)
  expect(() => mergeJsonRenderState(submitted, saved)).toThrow('already been submitted')
  for (const fields of [{ specJson: '{}' }, { summary: 'changed' }, { title: 'changed' }, { stateJson: '[' }, { stateJson: '[]' },
    { stateJson: 'null' }, { stateJson: '"text"' }, { stateJson: JSON.stringify({ huge: 'x'.repeat(65536) }) }, { submittedAt: -1 }]) {
    expect(() => mergeJsonRenderState(current, { ...current, ...fields })).toThrow()
  }
  expect(mergeJsonRenderState(current, { ...current, stateJson: '{}' }).stateJson).toBe('{}')
})

it('projects titled cards and text in order without specs or state, preserving non-UI delivery', () => {
  const card = buildGeneratedUiPart('card', data)!
  expect(generatedUiDeliveryText('fallback', [{ type: 'text', text: 'Before' }, card, { type: 'text', text: 'After' }]))
    .toBe('Before\n\n**Report**\nBug report\n\nAfter')
  expect(generatedUiDeliveryText('Bug report', [card])).toBe('**Report**\nBug report')
  expect(generatedUiDeliveryText('', [buildGeneratedUiPart('plain', { ...data, title: undefined })])).toBe('Bug report')
  expect(generatedUiDeliveryText('legacy text', [])).toBe('legacy text')
  expect(generatedUiDeliveryText('legacy text')).toBe('legacy text')
  expect(generatedUiDeliveryText('', [null, {}])).toBe('')
})

describe('json_render generated UI contract', () => {
  it('preserves all fields and serialized expressions verbatim', () => {
    const input = { ...data, summary: ' Bug report ', specJson: ` ${data.specJson} `, stateJson: ` ${data.stateJson} ` }
    expect(normalizeGeneratedUiData(input)).toEqual(input)
    const part = buildGeneratedUiPart('render-1', input)
    expect(part).toEqual({ type: 'data', id: 'render-1', dataType: 'overlay.generated_ui', data: input })
    expect(isGeneratedUiPart(part)).toBe(true)
    const publicPart: ConversationMessagePart | null = part
    expect(publicPart).toEqual(part)
  })
  it('preserves absent optional fields and future catalog versions for renderer fallback', () => {
    const minimal = { version: 1, kind: 'json_render', catalogVersion: 2, summary: 'Summary', specJson: '{}' }
    expect(normalizeGeneratedUiData(minimal)).toEqual(minimal)
    expect(generatedUiDataToPlainText(data)).toBe('Bug report')
  })
  it.each([
    null, {}, { ...data, version: 2 }, { ...data, summary: '' }, { ...data, specJson: '' },
    { ...data, catalogVersion: '1' }, { ...data, catalogVersion: Number.NaN },
    { ...data, stateJson: {} }, { ...data, submittedAt: 'now' }, { ...data, title: 1 },
  ])('rejects invalid contract values: %j', (value) => {
    expect(normalizeGeneratedUiData(value)).toBeNull()
    expect(buildGeneratedUiPart('render-1', value)).toBeNull()
  })
  it('rejects empty part ids', () => expect(buildGeneratedUiPart('', data)).toBeNull())
})
