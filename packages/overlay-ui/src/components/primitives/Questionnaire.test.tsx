import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionnaireSuggestions } from './Questionnaire'

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
