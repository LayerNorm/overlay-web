import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { QuestionnairePanel } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'
import { toAgentRunResource } from './useAgentRunLifecycle'
import { useWorkApproval } from './useWorkApproval'

const inputRun = toAgentRunResource({
  _id: 'run_1',
  _creationTime: 50,
  conversationId: 'conversation_real',
  userId: 'user_1',
  status: 'waiting_for_input',
  createdAt: 50,
  updatedAt: 100,
  inputRequest: { token: 'input-token', requestedAt: 100, question: 'Which folder should I use?' },
})

function nativeScope(isCurrentScope: () => boolean) {
  return {
    enabled: true,
    writable: true,
    status: 'ready' as const,
    scopeKey: 'user_1:workspace_1:pending-first',
    userId: 'user_1',
    workspaceId: 'workspace_1',
    conversationId: 'conversation_real',
    isCurrentScope,
  }
}

function InputCard({ current }: { current: () => boolean }) {
  const { workApprovalContent } = useWorkApproval({
    agentRunLifecycle: { run: inputRun, refresh: async () => inputRun } as never,
    activeChatId: PENDING_FIRST_CHAT_ID,
    nativeScope: nativeScope(current),
  })
  return createElement('div', null, workApprovalContent)
}

test('native waiting-for-input control submits once with the real conversation and exact run token', async (t) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const requests: unknown[] = []
  let resolveSubmission!: (result: { success: boolean }) => void
  const submitted = new Promise<{ success: boolean }>((resolve) => {
    resolveSubmission = resolve
  })
  t.mock.method(overlayAppClient.conversations, 'submitRunInput', async (request) => {
    requests.push(request)
    return submitted
  })
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => { renderer = create(createElement(InputCard, { current: () => true })) })
  const submitAnswers = renderer!.root.findByType(QuestionnairePanel).props.onAnswers as (
    answers: Record<string, string[]>,
  ) => void
  await act(async () => {
    const answers = { 'question-0': ['Projects'] }
    submitAnswers(answers)
    submitAnswers(answers)
    await Promise.resolve()
  })
  assert.deepEqual(requests, [{
    conversationId: 'conversation_real',
    agentRunId: 'run_1',
    token: 'input-token',
    text: 'Projects',
  }])
  await act(async () => {
    resolveSubmission({ success: true })
    await submitted
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
  await act(async () => {
    submitAnswers({ 'question-0': ['Again'] })
    await Promise.resolve()
  })
  assert.equal(requests.length, 1)
  await act(async () => { renderer!.unmount() })
})

test('native waiting-for-input control rejects a stale scope before submission', async (t) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const requests: unknown[] = []
  t.mock.method(overlayAppClient.conversations, 'submitRunInput', async (request) => {
    requests.push(request)
    return { success: true }
  })
  let current = true
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => { renderer = create(createElement(InputCard, { current: () => current })) })
  const submitAnswers = renderer!.root.findByType(QuestionnairePanel).props.onAnswers as (
    answers: Record<string, string[]>,
  ) => void
  current = false
  await act(async () => {
    submitAnswers({ 'question-0': ['Stale'] })
    await Promise.resolve()
  })
  assert.deepEqual(requests, [])
  await act(async () => { renderer!.unmount() })
})

test('native approval controls fail closed when compatibility is not writable', () => {
  const run = toAgentRunResource({
    _id: 'run_2',
    _creationTime: 50,
    conversationId: 'conversation_real',
    userId: 'user_1',
    status: 'waiting_for_approval',
    createdAt: 50,
    updatedAt: 100,
    approval: {
      token: 'approval-token',
      requestedAt: 100,
      requests: [{
        approvalId: 'approval-click',
        toolCallId: 'click-call',
        toolName: 'computer_browser',
        input: { action: 'click', ref: 'overlay-1', confirm: true },
      }],
    },
  })
  function ApprovalCard() {
    const { workApprovalContent } = useWorkApproval({
      agentRunLifecycle: { run, refresh: async () => run } as never,
      activeChatId: 'conversation_real',
      nativeScope: { ...nativeScope(() => true), writable: false },
    })
    return createElement('div', null, workApprovalContent)
  }
  const markup = renderToStaticMarkup(createElement(ApprovalCard))
  assert.match(markup, /disabled/)
  assert.match(markup, /Approve/)
})
