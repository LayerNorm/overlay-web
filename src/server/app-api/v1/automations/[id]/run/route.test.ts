import assert from 'node:assert/strict'
import test from 'node:test'
import { isDurableAutomationsEnabled } from './route'

// ---------------------------------------------------------------------------
// Feature flag logic
// ---------------------------------------------------------------------------

test('isDurableAutomationsEnabled returns false when env var is not set', () => {
  const original = process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
  delete process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
  assert.equal(isDurableAutomationsEnabled(), false)
  if (original !== undefined) process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = original
})

test('isDurableAutomationsEnabled returns true when env var is "1"', () => {
  const original = process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
  process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = '1'
  assert.equal(isDurableAutomationsEnabled(), true)
  if (original !== undefined) process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = original
  else delete process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
})

test('isDurableAutomationsEnabled returns true when env var is "true"', () => {
  const original = process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
  process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = 'true'
  assert.equal(isDurableAutomationsEnabled(), true)
  if (original !== undefined) process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = original
  else delete process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
})

test('isDurableAutomationsEnabled returns false when env var is "false"', () => {
  const original = process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
  process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = 'false'
  assert.equal(isDurableAutomationsEnabled(), false)
  if (original !== undefined) process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = original
  else delete process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
})

test('isDurableAutomationsEnabled returns false when env var is "0"', () => {
  const original = process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
  process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = '0'
  assert.equal(isDurableAutomationsEnabled(), false)
  if (original !== undefined) process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = original
  else delete process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
})

test('isDurableAutomationsEnabled returns false when env var is empty string', () => {
  const original = process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
  process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = ''
  assert.equal(isDurableAutomationsEnabled(), false)
  if (original !== undefined) process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = original
  else delete process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
})

test('isDurableAutomationsEnabled is case-sensitive (only lowercase "true" works)', () => {
  const original = process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
  process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = 'TRUE'
  assert.equal(isDurableAutomationsEnabled(), false)
  if (original !== undefined) process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS = original
  else delete process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
})
