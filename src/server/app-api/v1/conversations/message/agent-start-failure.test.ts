import assert from 'node:assert/strict'
import test from 'node:test'
import { agentStartFailureClass, agentStartFailureMessage } from './agent-start-failure'

test('agent-start failures expose safe recovery guidance without leaking server errors', () => {
  assert.equal(agentStartFailureClass(new Error('AGENT_ENVIRONMENT_OFFLINE')), 'host_offline')
  assert.equal(
    agentStartFailureMessage('Hermes', new Error('AGENT_ENVIRONMENT_OFFLINE')),
    'Hermes could not start because its connected environment is offline. Reconnect the environment, then send this message again.',
  )
  assert.equal(agentStartFailureClass(new Error('database secret detail')), 'start_failed')
  assert.equal(
    agentStartFailureMessage('Hermes', new Error('database secret detail')),
    'Hermes could not start this turn. Your message was saved; please try sending it again.',
  )
})

test('a computer that is gone says so and says what to do', async () => {
  const { agentStartFailureClass, agentStartFailureMessage } = await import('./agent-start-failure')
  const error = new Error('MANAGED_SANDBOX_LEASE_UNAVAILABLE')
  assert.equal(agentStartFailureClass(error), 'machine_gone')
  assert.match(agentStartFailureMessage('Codex agent', error), /Start a new machine/)
})

test('billing refusals say which billing problem stopped the agent and who can fix it', async () => {
  const { agentStartFailureClass, agentStartFailureMessage, agentStartFailureReason } = await import('./agent-start-failure')
  const refusal = (code: string, recovery: string) => Object.assign(new Error('Subscribe to this workspace before starting work.'), {
    name: 'WorkspaceExecutionError', payload: { code, recovery },
  })
  assert.equal(agentStartFailureClass(refusal('subscription_required', 'billing')), 'billing')
  assert.equal(
    agentStartFailureMessage('Overlay', refusal('subscription_required', 'billing')),
    "Overlay can't start because this workspace doesn't have a paid plan. Open Workspace Billing to fix this, then send this message again.",
  )
  assert.match(agentStartFailureMessage('Overlay', refusal('budget_exhausted', 'contact_owner')), /usage budget is used up\. Ask a workspace owner/)
  assert.deepEqual(agentStartFailureReason(refusal('payment_pending', 'billing')), {
    code: 'payment_pending', message: 'Payment not confirmed yet.', retryable: false,
  })
  // The budget reservation's bare Convex error is the same refusal.
  const bare = new Error('[CONVEX M(platform/usage:reserveBudgetByServer)] Uncaught Error: workspace_execution_required')
  assert.match(agentStartFailureMessage('Overlay', bare), /doesn't have a paid plan\. Open Workspace Billing \(or ask a workspace owner\)/)
  assert.equal(agentStartFailureReason(bare).code, 'subscription_required')
})

test('every start failure records a short reason instead of none', async () => {
  const { agentStartFailureReason } = await import('./agent-start-failure')
  assert.deepEqual(agentStartFailureReason(new Error('database secret detail')), {
    code: 'start_failed', message: 'The turn could not be started.', retryable: true,
  })
  assert.equal(agentStartFailureReason(new Error('AGENT_ENVIRONMENT_OFFLINE')).code, 'host_offline')
})
