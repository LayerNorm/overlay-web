import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppScreenHeader } from './shell'

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
