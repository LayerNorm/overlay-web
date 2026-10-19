import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Bubble, BubbleContent } from './bubble'
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle } from './code-block'
import { Message, MessageContent } from './message'
import { ProviderLogo, providerLabel } from './provider-logo'
import { Trace, TraceIcon, TraceLine, TraceTitle } from './trace'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('a trace line carries its status so a running title can shimmer and an error turns red', () => {
  const html = renderToStaticMarkup(
    <Trace>
      <TraceLine status="running"><TraceIcon /><TraceTitle>Reading file</TraceTitle></TraceLine>
      <TraceLine status="error"><TraceTitle>Failed to fetch</TraceTitle></TraceLine>
    </Trace>,
  )
  assert.match(html, /data-slot="trace-line" data-status="running"/)
  assert.match(html, /data-status="error"[^>]*text-\(--danger\)/)
  assert.match(html, /data-slot="trace-icon" aria-hidden="true"/)
})

test('code blocks number lines only when asked and stay flat with no resting ring or border', () => {
  const html = renderToStaticMarkup(
    <CodeBlock>
      <CodeBlockHeader><CodeBlockTitle>python</CodeBlockTitle></CodeBlockHeader>
      <CodeBlockContent lineNumbers>{'a = 1\nb = 2\n'}</CodeBlockContent>
    </CodeBlock>,
  )
  assert.equal(html.match(/data-slot="code-block-line"/g)?.length, 2)
  assert.match(html, /data-numbered="true"/)
  const block = html.match(/data-slot="code-block"[^>]*class="([^"]*)"/)?.[1] ?? ''
  assert.doesNotMatch(block, /(^|\s)(ring-1|border)(\s|$)/)
  assert.match(block, /bg-\(--surface-subtle\)/)
})

test('a user message aligns to the end and its bubble renders the text', () => {
  const html = renderToStaticMarkup(
    <Message align="end"><MessageContent><Bubble variant="muted"><BubbleContent>Hi</BubbleContent></Bubble></MessageContent></Message>,
  )
  assert.match(html, /data-slot="message" data-align="end"/)
  assert.match(html, />Hi</)
})

test('provider logos render inline currentColor marks and fall back for unknown providers', () => {
  const known = renderToStaticMarkup(<ProviderLogo provider="anthropic" size={14} />)
  assert.match(known, /data-provider="anthropic"/)
  assert.match(known, /fill="currentColor"/)
  assert.match(known, /width="14"/)
  const unknown = renderToStaticMarkup(<ProviderLogo provider="unknown-lab" />)
  assert.match(unknown, /lucide-cpu/)
  assert.equal(providerLabel('z-ai'), 'Z.ai')
  assert.equal(providerLabel('unknown-lab'), 'unknown-lab')
})
