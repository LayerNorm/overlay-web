import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRestoredRuntimeMessages } from './conversation-runtime-utils'

type Message = { id: string; role: 'user' | 'assistant' }

const user = (id: string): Message => ({ id, role: 'user' })
const assistant = (id: string): Message => ({ id, role: 'assistant' })

test('restored transcript keeps every exchange with its first response', () => {
  const linear = buildRestoredRuntimeMessages<Message>([
    { userMsg: user('u1'), responses: [{ msg: assistant('a1') }] },
    { userMsg: user('u2'), responses: [{ msg: assistant('a2') }, { msg: assistant('a2b') }] },
    { userMsg: user('u3'), responses: [] },
  ])

  assert.deepEqual(linear.map((message) => message.id), ['u1', 'a1', 'u2', 'a2', 'u3'])
})

test('restored transcript is empty without exchanges', () => {
  assert.deepEqual(buildRestoredRuntimeMessages<Message>([]), [])
})
