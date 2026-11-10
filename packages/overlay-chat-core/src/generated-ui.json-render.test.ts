import { describe, expect, it } from 'vitest'
import type { ConversationMessagePart } from '../../overlay-app-core/src/contracts/conversations'
import { buildGeneratedUiPart, generatedUiDataToPlainText, isGeneratedUiPart, normalizeGeneratedUiData } from './generated-ui'

const data = {
  version: 1 as const, kind: 'json_render' as const, catalogVersion: 1,
  summary: 'Bug report', title: 'Report',
  specJson: JSON.stringify({ root: 'input', elements: { input: { type: 'Input', props: { label: 'Title', value: { $bindState: '/title' } } } } }),
  stateJson: JSON.stringify({ title: 'A bug', price: '$1,200' }), submittedAt: 123,
}

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
