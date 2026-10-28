import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UsageExhaustedNotice, WORKSPACE_BILLING_HREF } from './UsageExhaustedNotice'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('paid usage notice links to workspace billing', () => {
  const html = renderToStaticMarkup(<UsageExhaustedNotice />)
  const copy = html.replaceAll('&#x27;', "'")

  assert.match(copy, /You're out of credits/)
  assert.match(copy, /Top up in Billing to keep chatting\./)
  assert.match(copy, /Open billing/)
  assert.ok(html.includes(`href="${WORKSPACE_BILLING_HREF.replaceAll('&', '&amp;')}"`))
})

test('free usage notice links to workspace upgrade', () => {
  const html = renderToStaticMarkup(<UsageExhaustedNotice variant="free" />)
  const copy = html.replaceAll('&#x27;', "'")

  assert.match(copy, /You've used this week's free chats/)
  assert.match(copy, /Upgrade for shared credits and every model\./)
  assert.match(copy, /Upgrade/)
  assert.match(html, /workspace_tab=billing&amp;upgrade=1/)
})
