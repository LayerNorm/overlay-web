import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UsageExhaustedNotice, WORKSPACE_BILLING_HREF } from './UsageExhaustedNotice'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('paid usage notice links to workspace billing', () => {
  const html = renderToStaticMarkup(<UsageExhaustedNotice />)
  const copy = html.replaceAll('&#x27;', "'")

  assert.match(copy, /Workspace billing is required to continue/)
  assert.match(copy, /Subscribe or add usage credit in Billing to continue\./)
  assert.match(copy, /Open billing/)
  assert.ok(html.includes(`href="${WORKSPACE_BILLING_HREF.replaceAll('&', '&amp;')}"`))
})
