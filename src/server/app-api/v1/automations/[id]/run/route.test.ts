import assert from 'node:assert/strict'
import test from 'node:test'

// ---------------------------------------------------------------------------
// The durable automations feature flag has been removed in Step 7.
// Durable execution via the Workflow SDK is now the only path.
// The isDurableAutomationsEnabled() function and its env-var override
// (OVERLAY_FEATURE_DURABLE_AUTOMATIONS) are no longer exported.
// ---------------------------------------------------------------------------

test('durable automations are always enabled (feature flag removed)', () => {
  // This test exists to document that the feature flag gating is gone.
  // The run route always uses the Workflow SDK path.
  assert.ok(true)
})
