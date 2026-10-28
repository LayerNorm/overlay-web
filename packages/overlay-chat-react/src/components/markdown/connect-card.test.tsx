import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownConnectorActionsContext } from './connector-actions-context'
import { stripEmojiBeforeConnectLinks } from './normalization'
import { ConnectServiceCard } from './renderers'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function render(actions?: React.ContextType<typeof MarkdownConnectorActionsContext>) {
  return renderToStaticMarkup(
    <MarkdownConnectorActionsContext.Provider value={actions}>
      <ConnectServiceCard serviceName="Gmail" href="https://example.com/oauth" />
    </MarkdownConnectorActionsContext.Provider>,
  )
}

test('connect cards show the app logo and a Connect action', () => {
  const markup = render({ getLogoUrl: () => 'https://logos.example/gmail.svg', isConnected: () => false, connect: () => undefined })
  assert.match(markup, /src="https:\/\/logos.example\/gmail.svg"/)
  assert.match(markup, /data-state="disconnected"/)
  assert.match(markup, />Connect</)
})

test('connect cards flip to Connected once the app is linked', () => {
  const markup = render({ getLogoUrl: () => null, isConnected: () => true })
  assert.match(markup, /data-state="connected"/)
  assert.match(markup, /Connected/)
  assert.doesNotMatch(markup, /href=/)
})

test('connect cards without live actions fall back to the link', () => {
  assert.match(render(), /href="https:\/\/example.com\/oauth"/)
})

test('decorative emoji before connect links are dropped', () => {
  assert.equal(stripEmojiBeforeConnectLinks('Tap 👉 [Connect Gmail](https://x.test)'), 'Tap [Connect Gmail](https://x.test)')
  assert.equal(stripEmojiBeforeConnectLinks('🔗 ✉️ [connect Notion](https://x.test)'), '[connect Notion](https://x.test)')
  assert.equal(stripEmojiBeforeConnectLinks('Done 🎉 [Docs](https://x.test)'), 'Done 🎉 [Docs](https://x.test)')
})

// Disabled integrations and unrecognized model-written service names retain their original destination.
test('connect cards keep the original link when the action cannot handle this service', () => {
  const markup = render({ canConnect: () => false, connect: () => { throw new Error('Unavailable action') } })
  assert.match(markup, /href="https:\/\/example.com\/oauth"/)
  assert.doesNotMatch(markup, /<button/)
})
