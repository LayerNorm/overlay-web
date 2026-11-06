import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, useEffect, useState } from 'react'
import { act, create } from 'react-test-renderer'
import type { HydratedRemoteMessage } from '../../../../../convex/lib/remoteMessageText'
import type { PersonalPendingTurn } from './personal-transcript'
import { projectPersonalTranscript } from './personal-transcript'
import { nativePendingTurnsForScope } from './native-personal-lifecycle'
import {
  buildNativeTranscriptView,
  projectScopedNativeTranscript,
  useNativePersonalTranscript,
} from './useNativePersonalTranscript'

const pending: PersonalPendingTurn = {
  turnId: 'turn', userAcknowledged: false, responses: [],
  user: { id: 'turn', turnId: 'turn', role: 'user', mode: 'act', contentType: 'text', model: 'model', createdAt: 1,
    parts: [{ type: 'text', text: 'Pending prompt' }] },
}

test('first-send overlay survives native creation while its query is loading, but never a different scope', () => {
  const input = {
    enabled: true, conversationId: 'created', pendingFirstConversationId: 'created',
    summaryConversationId: null, transcriptConversationId: null, rows: [], pendingTurns: [pending],
    sdkMessages: [pending.user, { id: 'sdk-response', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'Live' }] }],
  }
  const live = projectScopedNativeTranscript(input)
  assert.equal(live.projection.exchanges.length, 1)
  assert.equal(live.projection.exchanges[0].responses[0].id, 'sdk-response')
  assert.equal(projectScopedNativeTranscript({ ...input, conversationId: 'other' }).projection.messages.length, 0)
  assert.equal(projectScopedNativeTranscript({ ...input, enabled: false }).projection.messages.length, 0)
  assert.equal(projectScopedNativeTranscript({ ...input, pendingTurns: [] }).projection.messages.length, 0)
})

test('canonical observer view does not need SDK history and preserves orphan IDs and media output identities', () => {
  const user = { _id: 'user', _creationTime: 1, conversationId: 'chat', userId: 'owner', turnId: 'turn', role: 'user',
    mode: 'act', contentType: 'image', content: 'Draw', createdAt: 1 } as HydratedRemoteMessage
  const orphan = { ...user, _id: 'orphan', turnId: 'missing-user', role: 'assistant', contentType: 'text', content: 'Answer', createdAt: 2 } as HydratedRemoteMessage
  const projection = projectPersonalTranscript([
    { message: user, contextUser: null, outputs: [{ _id: 'output', turnId: 'turn', type: 'image', status: 'completed',
      prompt: 'Draw', modelId: 'image-model', createdAt: 2, url: '/api/v1/files/output/content' }] },
    { message: orphan, contextUser: null },
  ])
  const view = buildNativeTranscriptView(projection, [{ ...pending, localGenerationResults: [{ type: 'image', status: 'generating' }] }])
  assert.deepEqual(view.primaryMessages.map(message => message.id), ['turn', 'missing-user'])
  assert.deepEqual(view.primaryMessages[1].parts, [{ type: 'text', text: 'Original message unavailable' }])
  assert.equal(view.generationResults.get(0)?.[0].outputId, 'output')
  assert.equal(view.generationResults.get(0)?.[0].status, 'completed')
})

test('mounted transcript reconciliation updates the authoritative journal and settles', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const source = new Map([['turn', {
    ...pending, ownerId: 'owner', workspaceId: 'workspace',
  }]])
  const user = {
    _id: 'canonical-user', _creationTime: 1, conversationId: 'chat', userId: 'owner',
    turnId: 'turn', role: 'user', mode: 'act', contentType: 'text',
    content: 'Pending prompt', createdAt: 1,
  } as HydratedRemoteMessage
  let rows = [{ message: user, contextUser: null }]
  let currentScope = true
  let renders = 0
  let reconciliations = 0
  function Harness() {
    const [, setVersion] = useState(0)
    useEffect(() => { renders += 1 })
    useNativePersonalTranscript({
      enabled: true,
      conversationId: 'chat',
      summaryConversationId: 'chat',
      transcriptConversationId: 'chat',
      status: 'ready',
      rows,
      journal: nativePendingTurnsForScope(source, 'owner', 'workspace'),
      sourceJournal: source,
      sdkMessages: [],
      runtimeHydrationVersion: renders,
      onJournalChange: () => {
        reconciliations += 1
        setVersion(value => value + 1)
      },
      isCurrentScope: () => currentScope,
    })
    return null
  }
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => { renderer = create(createElement(Harness)) })
  assert.equal(source.get('turn')?.userAcknowledged, true)
  const assistant = {
    ...user, _id: 'canonical-assistant', role: 'assistant', content: 'Done',
    status: 'completed', createdAt: 2,
  } as HydratedRemoteMessage
  rows = [{ message: user, contextUser: null }, { message: assistant, contextUser: user }]
  currentScope = false
  await act(async () => { renderer!.update(createElement(Harness)) })
  assert.equal(source.has('turn'), true)
  currentScope = true
  await act(async () => { renderer!.update(createElement(Harness)) })
  assert.equal(source.has('turn'), false)
  assert.equal(reconciliations, 2)
  assert.ok(renders <= 8)
  await act(async () => { renderer!.unmount() })
})
