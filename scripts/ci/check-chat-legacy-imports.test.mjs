import assert from 'node:assert/strict'
import test from 'node:test'
import { findLegacyChatImports } from './check-chat-legacy-imports.mjs'

const specifiers = (source) => findLegacyChatImports(source).map((finding) => finding.specifier)

test('flags every import form of react-syntax-highlighter', () => {
  assert.deepEqual(specifiers("import { Prism } from 'react-syntax-highlighter'"), ['react-syntax-highlighter'])
  assert.deepEqual(specifiers("import style from 'react-syntax-highlighter/dist/esm/styles/prism'"), ['react-syntax-highlighter/dist/esm/styles/prism'])
  assert.deepEqual(specifiers("const m = await import('react-syntax-highlighter')"), ['react-syntax-highlighter'])
  assert.deepEqual(specifiers("const m = require(\"react-syntax-highlighter\")"), ['react-syntax-highlighter'])
  assert.deepEqual(specifiers("export { Prism } from 'react-syntax-highlighter'"), ['react-syntax-highlighter'])
  assert.deepEqual(specifiers("import 'react-syntax-highlighter'"), ['react-syntax-highlighter'])
})

test('flags removed components by path and name, including re-exports', () => {
  assert.deepEqual(specifiers("export * from './TranscriptScroll'"), ['./TranscriptScroll'])
  assert.deepEqual(specifiers('<LazySyntaxHighlighter code={code} />'), ['LazySyntaxHighlighter'])
  assert.deepEqual(specifiers('const scroll = useTranscriptScroll({})'), ['useTranscriptScroll'])
})

test('allows lookalike names and the replacements', () => {
  assert.deepEqual(specifiers("import { CodeBlock } from '@overlay/ui/ai'"), [])
  assert.deepEqual(specifiers("import x from 'react-syntax-highlighter-extra'"), [])
  assert.deepEqual(specifiers('const handleTranscriptScroll = () => {}'), [])
})
