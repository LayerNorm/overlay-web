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

test('caller classes style the control once, not the wrapper and the button', () => {
  const markup = renderToStaticMarkup(
    <Select aria-label="Frequency" value="interval" className="mt-1 w-full rounded-lg border border-(--border) bg-(--background) px-3 py-2">
      <option value="interval">Interval</option>
    </Select>,
  )

  // Count ELEMENTS carrying the caller's background, not raw string hits: cn() does
  // not dedupe, so the button legitimately lists its own border plus the caller's.
  // Applying className to the wrapper as well put the box on two elements — a
  // visible box inside a box on every migrated select.
  const classAttrs = [...markup.matchAll(/class="([^"]*)"/g)].map((m) => m[1] ?? '')
  const boxed = classAttrs.filter((c) => c.includes('bg-(--background)'))
  assert.equal(boxed.length, 1, `expected the caller box on one element, saw ${boxed.length}`)
  assert.equal(markup.includes('<button'), true)
})

test('native form bridge retains name, form, required, disabled and original empty values', () => {
  const markup = renderToStaticMarkup(
    <Select id="target" name="target" form="external" required disabled value="" aria-labelledby="target-label">
      <option value="">Choose target</option>
      <optgroup label="People" disabled><option value="a">Alpha</option></optgroup>
    </Select>,
  )
  assert.match(markup, /role="combobox"[^>]*aria-labelledby="target-label"/)
  assert.match(markup, /<select[^>]*name="target"[^>]*form="external"[^>]*required=""[^>]*disabled=""/)
  assert.match(markup, /<option value="" selected="">Choose target<\/option>/)
  assert.equal(markup.includes('name="target" value="option-'), false)
})

test('native option text supplies omitted values and label attributes supply visible labels', () => {
  const markup = renderToStaticMarkup(
    <Select aria-label="Plan" value="Pro plan"><option label="Professional">Pro plan</option></Select>,
  )
  assert.match(markup, /Professional/)
})

test('multi-select and visible native listboxes retain native semantics', () => {
  const multi = renderToStaticMarkup(<Select multiple name="plans" onChange={() => {}} value={['a', 'b']}><option value="a">Alpha</option><option value="b">Beta</option></Select>)
  assert.match(multi, /<select[^>]*multiple=""/)
  assert.equal((multi.match(/selected=""/g) ?? []).length, 2)
  assert.equal(multi.includes('role="combobox"'), false)
  const list = renderToStaticMarkup(<Select size={4}><option value="a">Alpha</option></Select>)
  assert.match(list, /<select[^>]*size="4"/)
})
