import assert from 'node:assert/strict'
import test from 'node:test'
import { billableBudgetCentsFromProviderUsd } from './billing-runtime'
import {
  AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD,
  AUTOMATION_WORKFLOW_STEPS_PER_RUN_ESTIMATE,
  VERCEL_WORKFLOW_PRICE_USD_PER_100K_STEPS,
} from './automation-workflow-billing'

test('workflow step estimate is billed with the canonical 25 percent markup', () => {
  assert.equal(AUTOMATION_WORKFLOW_STEPS_PER_RUN_ESTIMATE, 20)
  assert.equal(VERCEL_WORKFLOW_PRICE_USD_PER_100K_STEPS, 2.5)
  assert.equal(AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD, 0.0005)
  assert.equal(billableBudgetCentsFromProviderUsd(AUTOMATION_WORKFLOW_STEP_PROVIDER_COST_USD), 0.06)
})
