import assert from 'node:assert/strict'
import test from 'node:test'
import { selectedQuestionnaireChoices, toggleQuestionnaireChoice } from './questionnaire-draft'

const choices = [{ id: 'engineering', label: 'Engineering' }, { id: 'design', label: 'Design' }]

test('multiple choices combine in an editable draft without removing custom text', () => {
  let value = toggleQuestionnaireChoice('For a small team', choices, 'engineering', true)
  value = toggleQuestionnaireChoice(value, choices, 'design', true)
  assert.equal(value, 'For a small team · Engineering · Design')
  assert.deepEqual(selectedQuestionnaireChoices(value, choices), ['engineering', 'design'])
  assert.equal(toggleQuestionnaireChoice(value, choices, 'engineering', true), 'For a small team · Design')
})

test('the visible draft is authoritative after editing, clearing, and single selection', () => {
  assert.deepEqual(selectedQuestionnaireChoices('', choices), [])
  assert.deepEqual(selectedQuestionnaireChoices('Engineering leadership', choices), [])
  assert.equal(toggleQuestionnaireChoice('Engineering · Plus custom input', choices, 'design', false), 'Plus custom input · Design')
  assert.equal(toggleQuestionnaireChoice('Edited answer', choices, 'missing', true), 'Edited answer')
})
