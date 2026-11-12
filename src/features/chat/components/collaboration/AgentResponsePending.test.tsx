import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentResponsePending } from './AgentResponsePending'
import type { RoomMessageView } from './RoomMessageItem'

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
const pending = { id: 'reply', authorName: 'Agent', blocks: [], streaming: true } as unknown as RoomMessageView

test('three dots disappear on the first rendered token and do not return between steps', async () => {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<AgentResponsePending message={pending} />) })
  assert.equal(renderer.root.findAllByType('span').length, 3)
  await act(async () => { renderer.update(<AgentResponsePending message={{ ...pending, blocks: [{ kind: 'text', text: 'The' }] }} />) })
  assert.equal(renderer.toJSON(), null)
  await act(async () => { renderer.update(<AgentResponsePending message={pending} />) })
  assert.equal(renderer.toJSON(), null)
  await act(async () => { renderer.unmount() })
})

test('no pending dots for completed, failed, cancelled or input-blocked responses', () => {
  for (const patch of [
    { streaming: false }, { generationError: 'Failed' },
    { remoteRun: { state: 'cancelled' } }, { nativeInput: { token: 'request' } },
  ]) {
    assert.equal(renderToStaticMarkup(<AgentResponsePending message={{ ...pending, ...patch } as RoomMessageView} />), '')
  }
  assert.match(renderToStaticMarkup(<AgentResponsePending message={pending} />), /Agent is preparing a response/)
})
