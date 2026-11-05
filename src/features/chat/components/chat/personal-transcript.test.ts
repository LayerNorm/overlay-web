import assert from 'node:assert/strict'
import test from 'node:test'
import type { HydratedRemoteMessage } from '../../../../../convex/lib/remoteMessageText'
import { personalMessageToUi, projectPersonalTranscript, type PersonalPendingTurn } from './personal-transcript'

function message(id: string, turnId: string, role: 'user' | 'assistant', extra: Partial<HydratedRemoteMessage> = {}): HydratedRemoteMessage {
  return { _id: id, _creationTime: 1, conversationId: 'chat', userId: 'owner', turnId,
    role, mode: 'act', content: id, contentType: 'text', createdAt: 1, ...extra } as HydratedRemoteMessage
}

test('canonical projection includes remote users, all variants and exact partial-turn parents', () => {
  const user = message('user-db', 'turn', 'user')
  const variant = message('variant-db', 'turn', 'assistant', { variantIndex: 1, modelId: 'model' })
  const projection = projectPersonalTranscript([
    { message: variant, contextUser: user },
    { message: message('primary-db', 'turn', 'assistant', { variantIndex: 0, modelId: 'model' }), contextUser: user },
    { message: user, contextUser: null },
    { message: message('remote-user', 'remote', 'user', { createdAt: 2 }), contextUser: null },
  ])
  assert.equal(projection.exchanges.length, 2)
  assert.equal(projection.exchanges[0].user?.id, 'turn')
  assert.deepEqual(projection.exchanges[0].responses.map(response => response.persistedId), ['primary-db', 'variant-db'])
  assert.equal(projection.exchanges[1].user?.id, 'remote')
  assert.equal(projection.messages.length, 4)
})

test('orphan responses retain their turn and never attach to an unrelated preceding user', () => {
  const projection = projectPersonalTranscript([
    { message: message('user', 'unrelated', 'user'), contextUser: null },
    { message: message('orphan', 'missing', 'assistant', { createdAt: 2 }), contextUser: null },
  ])
  assert.equal(projection.exchanges[0].responses.length, 0)
  assert.equal(projection.exchanges[1].user, null)
  assert.equal(projection.exchanges[1].turnId, 'missing')
  assert.equal(projection.exchanges[1].responses[0].id, 'orphan')
})

test('explicit local overlays reconcile once and cannot overwrite terminal data or resurrect deleted users', () => {
  const user = message('user-db', 'turn', 'user')
  const final = message('response-db', 'turn', 'assistant', { modelId: 'model', status: 'completed', content: 'Canonical final' })
  const pending: PersonalPendingTurn = { turnId: 'turn', user: personalMessageToUi(user), userAcknowledged: false,
    responses: [personalMessageToUi(message('local-response', 'turn', 'assistant', { modelId: 'model', status: 'generating', content: 'Partial' }))] }
  const optimistic = projectPersonalTranscript([], [pending])
  assert.equal(optimistic.exchanges.length, 1)
  const reconciled = projectPersonalTranscript([{ message: user, contextUser: null }, { message: final, contextUser: null }], [pending])
  assert.equal(reconciled.messages.length, 2)
  assert.equal(reconciled.exchanges[0].responses[0].parts[0].type, 'text')
  assert.deepEqual(reconciled.exchanges[0].responses[0].parts, [{ type: 'text', text: 'Canonical final' }])
  assert.ok(reconciled.terminalTurnIds.has('turn'))
  assert.equal(projectPersonalTranscript([], [{ ...pending, userAcknowledged: true }]).messages.length, 0)
})

test('the native adapter retains file, tool and generated UI parts without lossy serialization', () => {
  const parts = [
    { type: 'file', url: '/file', fileName: 'document.pdf', mediaType: 'application/pdf' },
    { type: 'tool-invocation', toolInvocation: { toolCallId: 'call', toolName: 'lookup', state: 'result', args: { query: 'q' }, result: { value: 1 } } },
    { type: 'data', id: 'draft', dataType: 'overlay.generated_ui', data: { version: 1, kind: 'draft.text', body: 'Draft' } },
  ] as HydratedRemoteMessage['parts']
  const ui = personalMessageToUi(message('assistant', 'turn', 'assistant', { parts, replyToTurnId: 'earlier', replySnippet: 'Earlier', routedModelId: 'routed' }))
  assert.deepEqual(ui.parts, parts)
  assert.deepEqual(ui.metadata, { replyToTurnId: 'earlier', replySnippet: 'Earlier', routedModelId: 'routed', agentPlan: undefined })
})
