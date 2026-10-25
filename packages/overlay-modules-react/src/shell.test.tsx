import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppScreenHeader, AppScreenShell } from './shell'

test('header puts view tabs before actions and aligns title metadata on the baseline', () => {
  const markup = renderToStaticMarkup(
    <AppScreenHeader title="Work" metadata="3 open" search="Search tasks" tabs="List Board Timeline" actions="New task" />,
  )
  assert.ok(markup.indexOf('Search tasks') < markup.indexOf('List Board Timeline'))
  assert.ok(markup.indexOf('List Board Timeline') < markup.indexOf('New task'))
  assert.match(markup, /items-baseline/)
  assert.match(markup, /text-xs leading-5[^>]*>3 open/)
  assert.match(markup, /<h1[^>]*leading-5/)
})


test('right panels preserve their width without external width control', () => {
  const html = renderToStaticMarkup(<AppScreenShell rightPanel={<div>Details</div>} rightPanelOpen />)
  assert.match(html, /--app-screen-panel-width:384px/)
  assert.match(html, /aria-hidden="true"/)
  assert.match(html, /lg:relative/)
  assert.doesNotMatch(html, /lg:static/)
  const controlled = renderToStaticMarkup(<AppScreenShell rightPanel={<div>Details</div>} rightPanelWidth={480} onRightPanelResize={() => {}} />)
  assert.match(controlled, /--app-screen-panel-width:480px/)
})
