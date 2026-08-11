import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Select } from './Select'

// `<option>${amount / 100}/month</option>` hands `children` the array
// ['$', 8, '/month']. Coercing that with String() produced the user-visible
// "$,8,/month" in the workspace billing plan picker.
test('option labels flatten multi-node children instead of comma-joining them', () => {
  const markup = renderToStaticMarkup(
    <Select aria-label="Workspace monthly plan" value="800">
      {[800, 2_000].map((amount) => (
        <option key={amount} value={amount}>${amount / 100}/month</option>
      ))}
    </Select>,
  )

  assert.equal(markup.includes('$,8,/month'), false, 'comma-joined label leaked into markup')
  assert.equal(markup.includes('$8/month'), true, 'expected flattened "$8/month" label')
})

test('option labels fall back to the value when children are empty', () => {
  const markup = renderToStaticMarkup(
    <Select aria-label="Fallback" value="alpha">
      <option value="alpha" />
    </Select>,
  )

  assert.equal(markup.includes('alpha'), true)
})

test('nested elements inside an option still resolve to text', () => {
  const markup = renderToStaticMarkup(
    <Select aria-label="Nested" value="a">
      <option value="a"><span>Pro</span> plan</option>
    </Select>,
  )

  assert.equal(markup.includes('Pro plan'), true)
  assert.equal(markup.includes('[object Object]'), false)
})
