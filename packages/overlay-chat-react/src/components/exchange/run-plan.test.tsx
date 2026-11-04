import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RunPlan, type RunPlanPhase, type RunPlanStep } from './run-plan'

const step = (id: string, status: string): RunPlanStep => ({ id, title: `Step ${id}`, status })
const render = (steps: RunPlanStep[], phase: RunPlanPhase) => renderToStaticMarkup(<RunPlan steps={steps} phase={phase} />)
const allDone = [step('a', 'done'), step('b', 'skipped')]
const unfinished = [step('a', 'done'), step('b', 'running'), step('c', 'pending')]

test('shows every step and the count while the run is working, with nothing to collapse', () => {
  const markup = render(unfinished, 'active')
  assert.match(markup, /1 of 3 done/)
  for (const title of ['Step a', 'Step b', 'Step c']) assert.match(markup, new RegExp(title))
  assert.doesNotMatch(markup, /trace-collapsible-trigger/)
})

test('stays open while the response is still being written, even with every step done', () => {
  const markup = render(allDone, 'active')
  assert.match(markup, /Step a/)
  assert.doesNotMatch(markup, /trace-collapsible-trigger/)
})

test('collapses into a dropdown only once the response has ended with every step settled', () => {
  const markup = render(allDone, 'ended')
  assert.match(markup, /trace-collapsible-trigger/)
  assert.match(markup, /2 of 2 done/)
  assert.doesNotMatch(markup, /Step a/)
})

test('stays open when a response ends with steps unfinished, and shows where it stopped', () => {
  const markup = render(unfinished, 'ended')
  assert.doesNotMatch(markup, /trace-collapsible-trigger/)
  assert.match(markup, /stopped/)
  assert.match(markup, /Step c/)
})

test('shows which step is waiting for an answer', () => {
  const markup = render([step('a', 'done'), step('b', 'pending')], 'waiting')
  assert.match(markup, /waiting for your answer/)
  assert.doesNotMatch(markup, /trace-collapsible-trigger/)
})
