import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LandingHeadline } from './LandingHeadline'

test('the hero headline is one static line whose keywords link to their sections', () => {
  const html = renderToStaticMarkup(<LandingHeadline />)
  assert.match(html, /^<h1 class="h1">Enabling /)
  assert.ok(html.includes('<a class="k" href="#control-plane" style="--k:#7c3aed">self-driving companies</a>'))
  assert.ok(html.includes('<a class="k" href="#ai-employees" style="--k:#ea580c">AI employees</a>'))
  assert.equal(html.match(/<a /g)?.length, 2)
})
