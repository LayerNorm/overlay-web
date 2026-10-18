import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createMarkdownFrameIndex, markdownFrameKey } from './markdown-frame-index.mjs'

const key = (text: string) => markdownFrameKey({ units: text.length, sha256: createHash('sha256').update(text).digest('hex') })

test('unfinished citation frames verify preceding prose without crediting transient syntax', () => {
  const text = 'A useful finding. [NASA Facts](https://science.nasa.gov/earth/)'
  const partial = 'A useful finding. [NASA F'
  const { index, finalText } = createMarkdownFrameIndex({ parts: [text], sourceOffsets: [partial.length, text.length] })
  assert.equal(finalText, 'Ausefulfinding.NASAFacts')
  assert.equal(index.get(key('Ausefulfinding.[NASAF'))?.prefixUnits, 'Ausefulfinding.'.length)
  assert.equal(index.get(key(finalText))?.prefixUnits, finalText.length)
  assert.equal(index.has(key('Ausefulfinding.[NASAX')), false)
})

test('rendered emphasis and earlier text parts retain their exact canonical prefix', () => {
  const { index } = createMarkdownFrameIndex({ parts: ['Earlier.', 'A **useful** finding.'], sourceOffsets: ['Earlier.A **useful'.length] })
  assert.equal(index.get(key('Earlier.Auseful'))?.prefixUnits, 'Earlier.Auseful'.length)
})

test('wrong hashes and invalid source offsets cannot establish a visible prefix', () => {
  const { index } = createMarkdownFrameIndex({ parts: ['Public text.'], sourceOffsets: [6] })
  assert.equal(index.has(markdownFrameKey({ units: 6, sha256: '0'.repeat(64) })), false)
  for (const offset of [-1, 0.5, Number.NaN, 100]) {
    assert.throws(() => createMarkdownFrameIndex({ parts: ['Public text.'], sourceOffsets: [offset] }), RangeError)
  }
  assert.equal(createMarkdownFrameIndex({ parts: [], sourceOffsets: [] }).index.size, 0)
})
