import assert from 'node:assert/strict'
import test from 'node:test'
import { selectComposioAuthConfigId } from './ComposioIntegrationProvider'

test('prefers an enabled custom auth config over the Composio-managed one', () => {
  assert.equal(selectComposioAuthConfigId([
    { id: 'managed', status: 'ENABLED', isComposioManaged: true },
    { id: 'custom-off', status: 'DISABLED', isComposioManaged: false },
    { id: 'custom', status: 'ENABLED', isComposioManaged: false },
  ]), 'custom')
})

test('falls back to the first enabled config, and to none when all are disabled', () => {
  assert.equal(selectComposioAuthConfigId([
    { id: 'off', status: 'DISABLED' },
    { id: 'managed', status: 'ENABLED', isComposioManaged: true },
  ]), 'managed')
  assert.equal(selectComposioAuthConfigId([{ id: 'off', status: 'DISABLED' }]), null)
  assert.equal(selectComposioAuthConfigId([]), null)
})
