import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeRunQuestions, encodeRunQuestions, formatRunAnswers, runQuestionIssue } from './run-questions'

test('encoded questions decode back unchanged', () => {
  const questions = [{ prompt: 'Who is this for?', description: 'Sets the detail.', choices: [{ label: 'Team', description: 'All of it' }], allowCustomAnswer: true, optional: true }]
  assert.deepEqual(decodeRunQuestions(encodeRunQuestions(questions)), questions)
})

test('a plain stored question is one free-text question', () => {
  assert.deepEqual(decodeRunQuestions('Which currency?'), [{ prompt: 'Which currency?' }])
})

test('JSON that is not ours stays plain text', () => {
  assert.deepEqual(decodeRunQuestions('{"a":1}'), [{ prompt: '{"a":1}' }])
  assert.deepEqual(decodeRunQuestions('{"overlayRunQuestions":1,"questions":[{"prompt":""}]}'), [{ prompt: '{"overlayRunQuestions":1,"questions":[{"prompt":""}]}' }])
})

test('placeholder and too-short prompts are rejected', () => {
  for (const prompt of ['placeholder', ' Placeholder ', 'question', 'TBD', 'n/a', '...', '???', 'Which?']) {
    assert.match(runQuestionIssue([{ prompt }]) ?? '', /not a real question/, prompt)
  }
  assert.equal(runQuestionIssue([{ prompt: 'Which account should I update?' }]), null)
})

test('one question replies with just its answer', () => {
  assert.equal(formatRunAnswers([{ prompt: 'Which currency?' }], [['USD']]), 'USD')
  assert.equal(formatRunAnswers([{ prompt: 'Which colors?' }], [['Red', 'Blue']]), 'Red, Blue')
})

test('several questions pair each answer with its question and mark skips', () => {
  assert.equal(
    formatRunAnswers([{ prompt: 'Who is it for?' }, { prompt: 'Name customers?' }], [['Team'], []]),
    'Who is it for?\nTeam\n\nName customers?\n(skipped)',
  )
})
