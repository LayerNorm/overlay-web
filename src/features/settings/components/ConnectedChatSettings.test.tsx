import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConnectedChatSettingsBody } from './ConnectedChatSettings'

// Package components compile with the classic JSX runtime under the app's
// tsconfig, so they resolve React from the global.
;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('connected chat settings explain the surface in showcase mode', () => {
  const markup = renderToStaticMarkup(<ConnectedChatSettingsBody workspaceId={null} showcase />)
  assert.match(markup, /Connected chat/)
  assert.match(markup, /Answer workspace agents from Slack and MS Teams/)
})

test('connected chat settings render install and linking affordances', () => {
  const markup = renderToStaticMarkup(<ConnectedChatSettingsBody workspaceId="workspace-1" />)
  assert.match(markup, /Connected chat/)
  assert.match(markup, /Loading connected chat/)
})
