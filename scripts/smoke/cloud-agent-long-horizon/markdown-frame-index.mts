import { createHash } from 'node:crypto'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fromHtml } from 'hast-util-from-html'
import { MarkdownMessage } from '../../../packages/overlay-chat-react/src/components/MarkdownMessage'

type HtmlNode = ReturnType<typeof fromHtml> | ReturnType<typeof fromHtml>['children'][number]

function textContent(node: HtmlNode): string {
  if (node.type === 'text') return node.value
  return 'children' in node ? node.children.map(textContent).join('') : ''
}

export function markdownFrameText(input: { text: string; streaming: boolean }): string {
  const html = renderToStaticMarkup(React.createElement(MarkdownMessage, {
    text: input.text, isStreaming: input.streaming, suppressTypingIndicator: true, streamingMode: 'chunk',
  }))
  return textContent(fromHtml(html, { fragment: true })).replace(/\s+/gu, '')
}

export function markdownFrameKey(input: { units: number; sha256: string }): string {
  return `${input.units}:${input.sha256}`
}

/** Verifies text only. Timing, clipping, visibility and missing observations remain separate checks. */
export function createMarkdownFrameIndex(input: { parts: readonly string[]; sourceOffsets: readonly number[] }): {
  finalText: string; index: ReadonlyMap<string, { prefixUnits: number; sourceOffsets: readonly number[] }>
} {
  let rawLength = 0
  let finalText = ''
  const segments = input.parts.map(text => {
    const segment = { text, start: rawLength, before: finalText }
    rawLength += text.length
    finalText += markdownFrameText({ text, streaming: false })
    return segment
  })
  const index = new Map<string, { prefixUnits: number; sourceOffsets: number[] }>()
  for (const offset of new Set(input.sourceOffsets)) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > rawLength) {
      throw new RangeError('Source offset is outside the canonical Markdown parts')
    }
    const segment = segments.find(part => offset >= part.start && offset <= part.start + part.text.length)
    const rendered = segment
      ? segment.before + markdownFrameText({ text: segment.text.slice(0, offset - segment.start), streaming: true })
      : ''
    let prefixUnits = 0
    while (prefixUnits < rendered.length && prefixUnits < finalText.length && rendered[prefixUnits] === finalText[prefixUnits]) {
      prefixUnits++
    }
    const key = markdownFrameKey({ units: rendered.length, sha256: createHash('sha256').update(rendered).digest('hex') })
    const previous = index.get(key)
    if (previous && previous.prefixUnits !== prefixUnits) throw new Error('Ambiguous rendered Markdown frame')
    index.set(key, { prefixUnits, sourceOffsets: [...(previous?.sourceOffsets ?? []), offset] })
  }
  return { finalText, index }
}
