import assert from 'node:assert/strict'
import test from 'node:test'
import { planChoiceReason } from './OnboardingPlanChoice'

const summary = (subscription: Record<string, unknown>, state: string) => ({ subscription, executionAccess: { state, canExecute: state === 'ready' } }) as never
const unseen = { firstTask: false, paidFeature: false }

test('the plan choice follows the first task, then a lapsed trial, never a paid plan', () => {
  const trial = summary({ planKind: 'free', status: 'trialing' }, 'ready')
  assert.equal(planChoiceReason({ taskStatus: 'progress', summary: trial, seen: unseen }), null)
  assert.equal(planChoiceReason({ taskStatus: 'done', summary: trial, seen: unseen }), 'first_task')
  assert.equal(planChoiceReason({ taskStatus: 'done', summary: trial, seen: { firstTask: true, paidFeature: false } }), null)
  assert.equal(planChoiceReason({ summary: summary({ planKind: 'free', status: 'trialing' }, 'budget_exhausted'), seen: unseen }), 'paid_feature')
  assert.equal(planChoiceReason({ summary: summary({ planKind: 'free' }, 'subscription_required'), seen: unseen }), 'paid_feature')
  assert.equal(planChoiceReason({ taskStatus: 'done', summary: summary({ planKind: 'paid', status: 'active' }, 'ready'), seen: unseen }), null)
})
