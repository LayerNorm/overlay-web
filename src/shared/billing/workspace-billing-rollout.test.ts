import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveWorkspaceBillingRollout,
  workspaceBillingRolloutEnabled,
} from './workspace-billing-rollout'

test('workspace billing rollout is fail closed unless both master flag and stage are enabled', () => {
  assert.equal(workspaceBillingRolloutEnabled({ enabled: '1' }), false)
  assert.deepEqual(resolveWorkspaceBillingRollout({ enabled: '1', stage: 'unknown' }, 'workspace_1'), {
    checkoutEnabled: false,
    eligible: false,
    stage: 'off',
  })
  assert.equal(resolveWorkspaceBillingRollout({ enabled: '0', stage: 'general' }, 'workspace_1').eligible, false)
})

test('workspace billing rollout progresses from internal to selected to general', () => {
  const base = {
    enabled: 'true',
    internalWorkspaceIds: 'workspace_internal',
    selectedWorkspaceIds: 'workspace_selected',
  }
  assert.equal(resolveWorkspaceBillingRollout({ ...base, stage: 'internal' }, 'workspace_internal').eligible, true)
  assert.equal(resolveWorkspaceBillingRollout({ ...base, stage: 'internal' }, 'workspace_selected').eligible, false)
  assert.equal(resolveWorkspaceBillingRollout({ ...base, stage: 'selected' }, 'workspace_internal').eligible, true)
  assert.equal(resolveWorkspaceBillingRollout({ ...base, stage: 'selected' }, 'workspace_selected').checkoutEnabled, true)
  assert.equal(resolveWorkspaceBillingRollout({ ...base, stage: 'general' }, 'workspace_any').eligible, true)
})
