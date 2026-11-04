import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionnairePanel, QuestionnaireSuggestions } from './Questionnaire'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const choices = [
  { id: 'engineering', label: 'Engineering' },
  { id: 'design', label: 'Design' },
]

function renderSuggestions(disabled: boolean) {
  return renderToStaticMarkup(
    <QuestionnaireSuggestions
      questionId="question-1"
      choices={choices}
      value=""
      onDraftChange={() => {}}
      disabled={disabled}
    />,
  )
}

test('disabled suggestions remain visible while choice inputs are disabled', () => {
  const html = renderSuggestions(true)
  const item = html.match(/<fieldset\b[^>]*>/)?.[0]
  const inputs = html.match(/<input\b[^>]*>/g) ?? []

  assert.ok(item)
  assert.doesNotMatch(item, /\bhidden(?:\s|=|>)/)
  assert.doesNotMatch(item, /\bdisabled(?:\s|=|>)/)
  assert.equal(inputs.length, choices.length)
  assert.ok(inputs.every((input) => /\sdisabled(?:\s|=|>)/.test(input)))
  assert.ok(html.includes('Engineering'))
  assert.ok(html.includes('Design'))
})

test('enabled suggestions render enabled choice inputs', () => {
  const html = renderSuggestions(false)
  const inputs = html.match(/<input\b[^>]*>/g) ?? []

  assert.equal(inputs.length, choices.length)
  assert.ok(inputs.every((input) => !/\sdisabled(?:\s|=|>)/.test(input)))
})

test('a question with choices and a written answer never renders the primitive input that crashes beside choices', () => {
  const markup = renderToStaticMarkup(<QuestionnairePanel
    items={[
      { name: 'first', prompt: 'Who is this for?', required: true, choices: [{ value: 'Team', label: 'Team', description: 'Everyone' }], input: { label: 'Or write your own answer' } },
      { name: 'second', prompt: 'Should it name customers?', input: { label: 'Your answer' } },
    ]}
    onAnswers={() => undefined}
  />)
  assert.match(markup, /Who is this for\?/)
  assert.match(markup, /Should it name customers\?/)
  assert.match(markup, /Or write your own answer/)
  assert.match(markup, /role="progressbar"/)
  assert.equal((markup.match(/value="__written_answer__"/g) ?? []).length, 2)
})

test('one question needs no progress label', () => {
  const markup = renderToStaticMarkup(<QuestionnairePanel items={[{ name: 'only', prompt: 'Which currency?', input: { label: 'Your answer' } }]} onAnswers={() => undefined} />)
  assert.doesNotMatch(markup, /progressbar/)
})

test('sending disables only the buttons, because the primitive treats disabled answers as unanswered', () => {
  const markup = renderToStaticMarkup(<QuestionnairePanel
    disabled
    items={[{ name: 'only', prompt: 'Who is this for?', required: true, choices: [{ value: 'Team', label: 'Team' }], input: { label: 'Or write your own answer' } }]}
    onAnswers={() => undefined}
  />)
  assert.doesNotMatch(markup, /<input[^>]* disabled=""/)
  assert.match(markup, /<button[^>]* disabled=""/)
})
