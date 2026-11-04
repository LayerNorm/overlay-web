import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { isRunPlanSettled, RunPlan, type RunPlanPhase, type RunPlanStep } from './run-plan'

const step = (id: string, status: string): RunPlanStep => ({ id, title: `Step ${id}`, status })
const render = (steps: RunPlanStep[], phase: RunPlanPhase) => renderToStaticMarkup(<RunPlan steps={steps} phase={phase} />)
const allDone = [step('a', 'done'), step('b', 'skipped')]
const unfinished = [step('a', 'done'), step('b', 'running'), step('c', 'pending')]

test('shows every step and the count, and is not pinned to the screen', () => {
  const markup = render(unfinished, 'active')
  assert.match(markup, /1 of 3 done/)
  for (const title of ['Step a', 'Step b', 'Step c']) assert.match(markup, new RegExp(title))
  assert.doesNotMatch(markup, /sticky/)
})

test('a plan is settled only once the response has ended with every step finished or skipped', () => {
  assert.equal(isRunPlanSettled(allDone, 'ended'), true)
  assert.equal(isRunPlanSettled(allDone, 'active'), false)
  assert.equal(isRunPlanSettled(allDone, 'waiting'), false)
  assert.equal(isRunPlanSettled(unfinished, 'ended'), false)
  assert.equal(isRunPlanSettled([], 'ended'), false)
})

test('shows where a response stopped', () => {
  const markup = render(unfinished, 'ended')
  assert.match(markup, /stopped/)
  assert.match(markup, /Step c/)
})

test('shows which step is waiting for an answer', () => {
  assert.match(render([step('a', 'done'), step('b', 'pending')], 'waiting'), /waiting for your answer/)
})
