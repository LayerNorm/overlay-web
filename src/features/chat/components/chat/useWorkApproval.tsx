'use client'

import { useCallback, useRef, useState } from 'react'
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationBody, ConfirmationIcon, ConfirmationRequest, ConfirmationTitle } from '@overlay/chat-react'
import { Textarea, toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { useAgentRunLifecycle } from './useAgentRunLifecycle'

function RunInputRequest({
  conversationId,
  runId,
  token,
  question,
  refresh,
}: {
  conversationId: string
  runId: string
  token: string
  question: string
  refresh: () => Promise<unknown>
}) {
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const pending = useRef(false)
  const submit = async () => {
    const text = reply.trim()
    if (!text || pending.current || submitted) return
    pending.current = true
    setSubmitting(true)
    try {
      const result = await overlayAppClient.conversations.submitRunInput({
        conversationId,
        agentRunId: runId,
        token,
        text,
      })
      if (!result.success) throw new Error('Could not send your reply.')
    } catch (error) {
      pending.current = false
      setSubmitting(false)
      toast.error(error instanceof Error ? error.message : 'Could not send your reply.')
      return
    }
    setSubmitted(true)
    setSubmitting(false)
    try {
      await refresh()
    } catch {
      toast.error('Your reply was sent, but the run could not be refreshed.')
    }
  }

  return (
    <Confirmation className="mb-2">
      <ConfirmationIcon running={submitting} />
      <ConfirmationBody>
        <ConfirmationTitle>Your input is needed</ConfirmationTitle>
        <ConfirmationRequest className="whitespace-pre-wrap">{question}</ConfirmationRequest>
        <Textarea
          aria-label="Your reply"
          className="mt-2 min-h-16"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          maxLength={32_000}
          disabled={submitting || submitted}
        />
        <ConfirmationActions>
          <ConfirmationAction
            tone="primary"
            disabled={!reply.trim() || submitting || submitted}
            onClick={() => void submit()}
          >
            {submitted ? 'Reply sent' : 'Send reply'}
          </ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationBody>
    </Confirmation>
  )
}

export function useWorkApproval({
  agentRunLifecycle,
  activeChatId,
}: {
  agentRunLifecycle: ReturnType<typeof useAgentRunLifecycle>
  activeChatId: string | null
}) {
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)

  const submitWorkApproval = useCallback(async (approved: boolean) => {
    const run = agentRunLifecycle.run
    if (!activeChatId || !run?.approval || run.status !== 'waiting_for_approval') return
    setApprovalSubmitting(true)
    try {
      await overlayAppClient.conversations.submitRunApproval({
        conversationId: activeChatId,
        agentRunId: run.id,
        token: run.approval.token,
        approved,
      })
      await agentRunLifecycle.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not submit approval.')
    } finally {
      setApprovalSubmitting(false)
    }
  }, [activeChatId, agentRunLifecycle])

  const workApprovalContent = agentRunLifecycle.run?.status === 'waiting_for_approval' && agentRunLifecycle.run.approval
    ? (
        <Confirmation className="mb-2">
          <ConfirmationIcon running={approvalSubmitting} />
          <ConfirmationBody>
            <ConfirmationTitle>{agentRunLifecycle.run.approval.title ?? 'Approval needed'}</ConfirmationTitle>
            <ConfirmationRequest>
              {agentRunLifecycle.run.approval.requests.map((request) => request.toolName).join(', ')}
            </ConfirmationRequest>
            <ConfirmationActions>
              <ConfirmationAction tone="primary" disabled={approvalSubmitting} onClick={() => void submitWorkApproval(true)}>
                Approve
              </ConfirmationAction>
              <ConfirmationAction disabled={approvalSubmitting} onClick={() => void submitWorkApproval(false)}>
                Deny
              </ConfirmationAction>
            </ConfirmationActions>
          </ConfirmationBody>
        </Confirmation>
      )
    : agentRunLifecycle.run?.status === 'waiting_for_input' && agentRunLifecycle.run.inputRequest && activeChatId
      ? (
          <RunInputRequest
            key={`${agentRunLifecycle.run.id}:${agentRunLifecycle.run.inputRequest.token}`}
            conversationId={activeChatId}
            runId={agentRunLifecycle.run.id}
            token={agentRunLifecycle.run.inputRequest.token}
            question={agentRunLifecycle.run.inputRequest.question}
            refresh={agentRunLifecycle.refresh}
          />
        )
      : undefined

  return { workApprovalContent }
}
