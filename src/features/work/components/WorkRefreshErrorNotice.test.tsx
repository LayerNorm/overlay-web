import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkRefreshErrorNotice } from './WorkRefreshErrorNotice'

test('Work keeps a refresh failure visible with a retry action', () => {
  const html = renderToStaticMarkup(
    <WorkRefreshErrorNotice error="Could not refresh tasks." onRetry={() => undefined} />,
  )

  assert.match(html, /role="alert"/)
  assert.match(html, /Could not refresh tasks\./)
  assert.match(html, />Retry</)
})

test('Work shows no stale error after recovery', () => {
  assert.equal(renderToStaticMarkup(<WorkRefreshErrorNotice error={null} onRetry={() => undefined} />), '')
})
