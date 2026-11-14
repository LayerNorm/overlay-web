import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isTooltipWarm, markTooltipClosed, markTooltipOpened } from './tooltip-warmth'

test('tooltips start cold, stay warm while one is open and shortly after it closes', async () => {
  assert.equal(isTooltipWarm(), false)
  markTooltipOpened()
  assert.equal(isTooltipWarm(), true)
  markTooltipClosed()
  assert.equal(isTooltipWarm(), true, 'moving to a neighbouring control should show its tooltip at once')
  await new Promise((resolve) => setTimeout(resolve, 550))
  assert.equal(isTooltipWarm(), false, 'after a pause the next tooltip waits again')
})

test('an extra close never leaves the open count negative', () => {
  markTooltipClosed()
  markTooltipOpened()
  assert.equal(isTooltipWarm(), true)
  markTooltipClosed()
})
