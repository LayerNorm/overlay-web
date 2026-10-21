import assert from 'node:assert/strict'
import test from 'node:test'
import { extractOnboardingName, onboardingChoices, onboardingEmployeesFor, onboardingList, onboardingTasksFor } from './session'

test('onboarding name does not offer an auth-derived draft choice', () => {
  assert.deepEqual(onboardingChoices({ step: 'name', suggestions: [] }), [])
})

test('conversational name answers become just the name', () => {
  const cases: Record<string, string> = {
    'You can call me Divyansh': 'Divyansh',
    'you can call me divyansh.': 'Divyansh',
    "I'm Ada": 'Ada',
    'im ada': 'Ada',
    'My name is Ada Lovelace': 'Ada Lovelace',
    'Hi! Call me Dev please': 'Dev',
    "It's Sam, but Sammy is fine": 'Sam',
    'Divyansh': 'Divyansh',
    'mcKenzie': 'mcKenzie',
    '...': '',
  }
  for (const [input, expected] of Object.entries(cases)) assert.equal(extractOnboardingName(input), expected, input)
})

test('suggestions follow the chosen help areas, then the role', () => {
  const profile = { name: 'Ada', about: 'Engineering', daily: 'Email & follow-ups' }
  assert.deepEqual(onboardingEmployeesFor(profile).map((employee) => employee.name), ['Relay', 'Spec'])
  assert.equal(onboardingTasksFor(profile).length, 3)
  assert.deepEqual(onboardingEmployeesFor({ name: 'Ada', about: 'Something else', daily: 'custom text' }).map((employee) => employee.name), ['Scout', 'Atlas'])
})

test('lists join the way a person would', () => {
  assert.equal(onboardingList(['A']), 'A')
  assert.equal(onboardingList(['A', 'B']), 'A and B')
  assert.equal(onboardingList(['A', 'B', 'C']), 'A, B and C')
})
