import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit } from './prompt-input'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('the composer shell has a subtle theme-aware outline, including while dragging', () => {
  const html = renderToStaticMarkup(
    <PromptInput dragging><PromptInputBody><PromptInputFooter /></PromptInputBody></PromptInput>,
  )
  assert.match(html, /data-slot="prompt-input" data-dragging="true"/)
  assert.match(html, /rounded-2xl border border-\(--border\)/)
  assert.match(renderToStaticMarkup(<PromptInput />), /rounded-2xl border border-\(--border\)/)
})

test('submit shows send, spinner, or stop by status', () => {
  const ready = renderToStaticMarkup(<PromptInputSubmit />)
  assert.match(ready, /aria-label="Send message"/)
  assert.match(ready, /lucide-arrow-up/)
  const submitted = renderToStaticMarkup(<PromptInputSubmit status="submitted" />)
  assert.match(submitted, /disabled=""/)
  const streaming = renderToStaticMarkup(<PromptInputSubmit status="streaming" onStop={() => {}} disabled />)
  assert.match(streaming, /aria-label="Stop generating"/)
  assert.doesNotMatch(streaming, /disabled=""/)
})
