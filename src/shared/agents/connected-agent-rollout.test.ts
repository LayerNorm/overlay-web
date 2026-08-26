import assert from 'node:assert/strict'
import test from 'node:test'
import {
  connectedAgentRolloutEnabled,
  parseConnectedAgentRolloutStage,
  resolveConnectedAgentRollout,
} from './connected-agent-rollout'
import { DEFAULT_OVERLAY_RUNTIME_CONFIG } from '@/shared/config/defaultOverlayRuntimeConfig'

test('connected-agent incident switches default off', () => {
  assert.equal(DEFAULT_OVERLAY_RUNTIME_CONFIG.features.connectedAgentControlPlane, false)
  assert.equal(DEFAULT_OVERLAY_RUNTIME_CONFIG.features.remoteAgentRuns, false)
  assert.equal(DEFAULT_OVERLAY_RUNTIME_CONFIG.features.overlayCloudEnvironments, false)
})

test('connected-agent rollout fails closed for missing and invalid stages', () => {
  assert.equal(parseConnectedAgentRolloutStage(undefined), 'off')
  assert.equal(parseConnectedAgentRolloutStage('everyone'), 'off')
  assert.equal(connectedAgentRolloutEnabled({}), false)
  assert.deepEqual(resolveConnectedAgentRollout({}, 'workspace-internal'), {
    eligible: false,
    stage: 'off',
  })
})

test('connected-agent rollout widens from internal allowlist to invited and general', () => {
  const allowlists = {
    internalWorkspaceIds: ' workspace-internal ',
    invitedWorkspaceIds: 'workspace-invited',
  }
  assert.equal(resolveConnectedAgentRollout({ ...allowlists, stage: 'internal' }, 'workspace-internal').eligible, true)
  assert.equal(resolveConnectedAgentRollout({ ...allowlists, stage: 'internal' }, 'workspace-invited').eligible, false)
  assert.equal(resolveConnectedAgentRollout({ ...allowlists, stage: 'invited' }, 'workspace-internal').eligible, true)
  assert.equal(resolveConnectedAgentRollout({ ...allowlists, stage: 'invited' }, 'workspace-invited').eligible, true)
  assert.equal(resolveConnectedAgentRollout({ ...allowlists, stage: 'invited' }, 'workspace-other').eligible, false)
  assert.equal(resolveConnectedAgentRollout({ ...allowlists, stage: 'general' }, 'workspace-other').eligible, true)
})
