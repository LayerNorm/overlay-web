import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSkillFields } from '../../../shared/integrations/native-skill-fields'
import { nativeSkillErrorMessage, SKILL_INVALID_MESSAGE } from './native-skill-errors'

test('invalid native skill errors use the validation message', () => {
  const message = nativeSkillErrorMessage(new Error('INVALID_SKILL'), 'update')

  assert.equal(message, SKILL_INVALID_MESSAGE)
  assert.doesNotMatch(message, /access/i)
})

test('native skill access errors explain that access changed', () => {
  const message = nativeSkillErrorMessage(new Error('SKILL_ACCESS_DENIED'), 'create')

  assert.match(message, /access changed/)
})

test('unknown native skill errors use neutral copy', () => {
  const message = nativeSkillErrorMessage(new Error('Server Error'), 'update')

  assert.match(message, /Could not update this skill/)
  assert.doesNotMatch(message, /access/i)
})

test('native skill fields reject invalid values and trim valid values', () => {
  const fields = { name: 'Name', description: 'Description', instructions: 'Instructions', enabled: true }

  assert.equal(normalizeSkillFields({ ...fields, name: 'n'.repeat(501) }), null)
  assert.equal(normalizeSkillFields({ ...fields, description: '   ' }), null)
  assert.deepEqual(normalizeSkillFields({
    ...fields,
    name: '  Name  ',
    description: '  Description  ',
    instructions: '  Instructions  ',
  }), fields)
})
