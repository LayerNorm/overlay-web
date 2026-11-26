import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LandingHeadline } from './LandingHeadline'

test('the hero headline names Overlay as the AI Chief of Staff for teams', () => {
  const html = renderToStaticMarkup(<LandingHeadline />)
  assert.equal(html, '<h1 class="h1">The AI Chief of Staff<span class="br-md"></span> that works with your team</h1>')
})
