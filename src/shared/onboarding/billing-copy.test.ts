import assert from 'node:assert/strict'
import test from 'node:test'
import { onboardingTaskMessage } from './billing-copy'

test('saved task copy distinguishes paid, free member, and free manager', () => {
  assert.equal(onboardingTaskMessage({ canManage: false, executionAccess: { state: 'ready', canExecute: true } }, 'Acme'), "Saved. Acme's budget covers this, so you can start now.")
  assert.equal(onboardingTaskMessage({ canManage: false, executionAccess: { state: 'subscription_required', canExecute: false } }, 'Acme'), 'Saved as a draft. Acme needs an active plan before tasks can run, and only owners and admins can set that up.')
  assert.equal(onboardingTaskMessage({ canManage: true, executionAccess: { state: 'subscription_required', canExecute: false } }, 'Acme'), "I've saved your first task. We'll check your workspace budget before we start.")
})
