import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssistantVisualBlock } from '@overlay/chat-core'
import { MarkdownMessage } from '../MarkdownMessage'
import { ToolCallRowWithReasoning } from '../exchange/tool-call-rows'
import { collectCreatedFileIds } from '../markdown/tool-resource-links'
import { ChatFileCardStrip } from './ChatFileCards'
import { ChatFilesProvider, fileIdFromContentHref, type ChatFileSummary, type ChatFilesHost } from './chat-files-context'

const files: ChatFileSummary[] = [
  { _id: 'vid1', name: 'day-01.mp4', mimeType: 'video/mp4' },
  { _id: 'img1', name: 'sheet.png', mimeType: 'image/png' },
  { _id: 'note1', name: 'Render notes', kind: 'note', previewText: 'Removed the counters.' },
]
const host: ChatFilesHost = {
  useFileSummaries: (ids) => new Map(files.filter(file => ids.includes(file._id)).map(file => [file._id, file])),
  openFile: () => undefined,
}
const withHost = (node: React.ReactNode) => renderToStaticMarkup(<ChatFilesProvider value={host}>{node}</ChatFilesProvider>)

function tool(name: string, toolOutput: unknown, toolInput: Record<string, unknown> = {}): AssistantVisualBlock {
  return { kind: 'tool', key: `${name}-${JSON.stringify(toolOutput)}`, name, state: 'output-available', toolInput, toolOutput }
}

test('Overlay file URLs resolve to their file id; other links do not', () => {
  assert.equal(fileIdFromContentHref('/api/v1/files/abc%3A1/content'), 'abc:1')
  assert.equal(fileIdFromContentHref('https://getoverlay.io/api/v1/files/abc/content?x=1'), 'abc')
  assert.equal(fileIdFromContentHref('https://example.com/pic.png'), null)
  assert.equal(fileIdFromContentHref('/api/v1/files/abc'), null)
})

test('a turn shows each created file once: inline where embedded, in the strip otherwise', () => {
  const blocks: AssistantVisualBlock[] = [
    tool('computer_publish_file', { success: true, artifact: { fileId: 'vid1' } }),
    tool('generate_image', { success: true, outputId: 'img1' }),
    tool('create_note', { success: true, noteId: 'note1' }),
    tool('create_note', { success: true, noteId: 'note1' }),
    tool('generate_video', { success: true, status: 'pending', outputId: 'pending1' }),
    tool('write_file', { success: true, fileId: 'edited' }, { fileId: 'edited', content: '' }),
    tool('create_note', { success: false, noteId: 'failed' }),
    { kind: 'text', text: 'Here it is: ![sheet](/api/v1/files/img1/content)' },
  ]
  assert.deepEqual(collectCreatedFileIds(blocks), ['vid1', 'note1'])
})

test('the strip renders videos, images and notes as compact cards', () => {
  const html = withHost(<ChatFileCardStrip fileIds={['vid1', 'img1', 'note1', 'unreadable']} />)
  assert.match(html, /aria-label="Play day-01\.mp4"/)
  assert.match(html, /max-w-\[600px\]/)
  assert.match(html, /max-h-\[240px\][^"]*max-w-\[min\(100%,320px\)\]/)
  assert.match(html, /Render notes/)
  assert.match(html, /Removed the counters\./)
  assert.doesNotMatch(html, /unreadable/)
})

test('without a host lookup the strip renders nothing rather than guessing', () => {
  assert.equal(renderToStaticMarkup(<ChatFileCardStrip fileIds={['vid1']} />), '')
})

test('Markdown images render as capped thumbnails, never full width', () => {
  const external = renderToStaticMarkup(<MarkdownMessage text="![chart](https://example.com/chart.png)" isStreaming={false} />)
  assert.match(external, /max-w-\[min\(100%,320px\)\]/)
  assert.match(external, /aria-label="Enlarge chart"/)
  const overlayVideo = withHost(<MarkdownMessage text="![film](/api/v1/files/vid1/content)" isStreaming={false} />)
  assert.match(overlayVideo, /aria-label="Play day-01\.mp4"/)
})

test('tool rows say what the call did', () => {
  const block = (name: string, toolInput: Record<string, unknown>, toolOutput: unknown) =>
    ({ kind: 'tool' as const, key: name, name, state: 'output-available', toolInput, toolOutput })
  const ran = renderToStaticMarkup(<ToolCallRowWithReasoning block={block('computer_exec', { command: 'npm test' }, { success: true })} />)
  assert.match(ran, />Ran</)
  assert.match(ran, /<code[^>]*>npm test<\/code>/)
  assert.doesNotMatch(ran, /Running a command on the computer/)
  const edited = renderToStaticMarkup(<ToolCallRowWithReasoning block={block('computer_write_file',
    { path: 'src/WorkTaskComposer.tsx', contents: '' }, { success: true, created: false, linesAdded: 20, linesRemoved: 6 })} />)
  assert.match(edited, /Edited/)
  assert.match(edited, /WorkTaskComposer\.tsx/)
  assert.match(edited, /\+20/)
  assert.match(edited, /−6/)
  const created = withHost(<ToolCallRowWithReasoning block={block('computer_publish_file',
    { name: 'day-01.mp4' }, { success: true, artifact: { fileId: 'vid1' } })} />)
  assert.match(created, /<button[^>]*>.*day-01\.mp4/)
})
