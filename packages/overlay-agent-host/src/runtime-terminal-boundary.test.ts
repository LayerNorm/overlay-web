import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentAdapterSession } from './adapter.js'
import {createNativeTerminalIntent, observeActiveNativeRuns, withNativeTerminalBoundary} from './runtime-terminal-boundary.js'

test('a late native process probe cannot report loss after completion or replacement', async () => {
  for (const outcome of ['ended', 'replaced']) {
    let release: (value: 'lost') => void = () => {throw Error('probe missing')}
    const probe = new Promise<'lost'>(resolve => {release = resolve})
    const session: AgentAdapterSession = {remoteSessionId: 'native', observe: () => probe,
      async prompt() {}, async approve() {}, async elicit() {}, async cancel() {}, async resume() {}, async stop() {}}
    const executions = new Map([['run', {attemptId: 'old', generation: 1}]]), ended = new Set<string>()
    const reports: string[] = []
    const pending = observeActiveNativeRuns(new Map([['run', session]]), executions, ended,
      async (_runId, process) => {reports.push(process)})
    if (outcome === 'ended') createNativeTerminalIntent({execution: executions.get('run'),
      currentExecution: () => executions.get('run'), shuttingDown: () => false,
      markEnded: () => {ended.add('run')}})()
    else executions.set('run', {attemptId: 'new', generation: 2})
    release('lost')
    await pending
    assert.deepEqual(reports, [])
  }
})

test('a native result notification cannot end a replacement execution or a shutting-down host', () => {
  const original = {attemptId: 'original', generation: 1}
  let current = original, shuttingDown = false, ended = 0
  const notify = createNativeTerminalIntent({execution: original, currentExecution: () => current,
    shuttingDown: () => shuttingDown, markEnded: () => {ended++}})
  current = {attemptId: 'replacement', generation: 2}
  notify()
  assert.equal(ended, 0)
  current = original
  shuttingDown = true
  notify()
  assert.equal(ended, 0)
  shuttingDown = false
  notify()
  assert.equal(ended, 1)
})

test('a stale provider terminal callback retains its event without ending the replacement writer', async () => {
  let marked = 0
  const events: string[] = [], source = {attemptId: 'old', generation: 1}
  let current = {attemptId: 'new', generation: 2}
  const emit = withNativeTerminalBoundary({execution: source, currentExecution: () => current,
    shuttingDown: () => false, markEnded: () => {marked++}, forward: async event => {events.push(event.type)}})
  await emit({type: 'completed', payload: {usage: {}}})
  assert.equal(marked, 0)
  current = source
  await emit({type: 'completed', payload: {usage: {}}})
  assert.equal(marked, 1)
  assert.deepEqual(events, ['completed', 'completed'])
})
