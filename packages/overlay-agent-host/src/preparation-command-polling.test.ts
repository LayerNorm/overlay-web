import assert from 'node:assert/strict'
import test from 'node:test'
import type {AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'
import {processPolledCommands} from './preparation-command-polling'

const start: AgentHostCommand = {protocolVersion: 1, commandId: 'start', sequence: 1, issuedAt: 1,
  environmentId: 'environment', workspaceId: 'workspace', runId: 'run', execution: {attemptId: 'attempt', generation: 2},
  type: 'start', payload: {adapterId: 'fake', bindingId: 'binding', workingDirectory: '/workspace', prompt: 'Continue', metadata: {}}}
const stop: AgentHostCommand = {...start, commandId: 'stop', sequence: 2, type: 'cancel', payload: {reason: 'user requested'}}

test('newly polled Stop interrupts preparation but dispatch and acknowledgements remain ordered', async () => {
  const dispatched: string[] = [], received: number[] = []
  let cursor = 0, polls = 0
  await processPolledCommands({commands: [start],
    poll: async () => {polls++; assert.equal(cursor, 0); return {commands: [start, stop], resolvedThroughSequence: 0}},
    received: response => {received.push(response.resolvedThroughSequence ?? -1)}, onError: error => {throw error},
    process: async (command, signal) => {
      dispatched.push(command.commandId)
      if (command.type === 'start') {
        assert.equal(cursor, 0)
        if (!signal?.aborted) await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), {once: true}))
        assert.equal(signal?.aborted, true)
        cursor = command.sequence
        throw signal?.reason
      }
      assert.equal(command.sequence, cursor + 1)
      cursor = command.sequence
    },
  })
  assert.deepEqual(dispatched, ['start', 'stop'])
  assert.deepEqual(received, [0])
  assert.equal(cursor, 2)
  assert.equal(polls, 1)
})

test('foreign or older Stop cannot interrupt preparation; an outstanding long poll is aborted on completion', async t => {
  for (const foreign of [{workspaceId: 'other'}, {environmentId: 'other'}, {runId: 'other'}, {sequence: 0},
    {execution: {attemptId: 'old', generation: 2}}, {execution: {attemptId: 'attempt', generation: 1}}]) await t.test(JSON.stringify(foreign), async () => {
    const pendingStop = {...stop, ...foreign} as AgentHostCommand
    let pollingStopped = false
    await processPolledCommands({commands: [start, pendingStop], onError: error => {throw error}, received: () => undefined,
      poll: signal => new Promise(resolve => {signal.addEventListener('abort', () => {pollingStopped = true; resolve({commands: []})}, {once: true})}),
      process: async (command, signal) => {if (command.type === 'start') {await Promise.resolve(); assert.equal(signal?.aborted, false)}},
    })
    assert.equal(pollingStopped, true)
  })
})

test('a failed start never dispatches the following Stop out of order or suppresses the original failure', async () => {
  const dispatched: string[] = []
  await assert.rejects(processPolledCommands({commands: [start, stop], poll: async () => ({commands: []}),
    onError: error => {throw error}, received: () => undefined,
    process: async (command, signal) => {dispatched.push(command.commandId); assert.equal(signal?.aborted, true); throw Error('start rejected')},
  }), /start rejected/)
  assert.deepEqual(dispatched, ['start'])
})
