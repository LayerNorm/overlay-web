import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OVERLAY_LOGO_SRC } from '@overlay/chat-core'
import { ChatReactConfigContext } from '../../context/chat-react-config'
import { ToolLineLogo } from './tool-rail'

test('tool rail uses the host-provided Overlay logo URL', () => {
  const markup = renderToStaticMarkup(
    <ChatReactConfigContext.Provider value={{ toolLogoUrl: 'app://overlay-logo.png' }}>
      <ToolLineLogo />
    </ChatReactConfigContext.Provider>,
  )

  assert.match(markup, /src="app:\/\/overlay-logo\.png"/)
  assert.match(markup, /width="8"/)
  assert.match(markup, /height="8"/)
  assert.match(markup, /size-2/)
})

test('tool rail retains the web logo fallback', () => {
  const markup = renderToStaticMarkup(<ToolLineLogo />)
  assert.ok(markup.includes(`src="${OVERLAY_LOGO_SRC}"`))
})
