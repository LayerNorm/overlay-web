'use client'

import { useRef, useState } from 'react'
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationBody, ConfirmationIcon, ConfirmationRequest, ConfirmationTitle } from '@overlay/chat-react'
import { toast } from '@overlay/ui/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { NativeAgentApproval } from '@/shared/agents/native-agent-approval'

export function NativeAgentApprovalCard({ approval }: { approval: NativeAgentApproval }) {
  const { user } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const inFlight = useRef(false)
  const canApprove = user?.id === approval.userId

  async function submit(approved: boolean) {
    if (!canApprove || inFlight.current || submitted) return
    inFlight.current = true
    setSubmitting(true)
    try {
      await overlayAppClient.conversations.submitRunApproval({
        conversationId: approval.conversationId,
        agentRunId: approval.runId,
        token: approval.token,
        approved,
      })
      setSubmitted(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not submit approval.')
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return <NativeAgentApprovalContent approval={approval} canApprove={canApprove}
    submitting={submitting} submitted={submitted} onSubmit={(approved) => void submit(approved)} />
}

export function NativeAgentApprovalContent({ approval, canApprove, submitting, submitted, onSubmit }: {
  approval: NativeAgentApproval
  canApprove: boolean
  submitting: boolean
  submitted: boolean
  onSubmit(approved: boolean): void
}) {
  return (
    <Confirmation className="mt-2">
      <ConfirmationIcon running={submitting} />
      <ConfirmationBody>
        <ConfirmationTitle>Agent needs your approval</ConfirmationTitle>
        <ConfirmationRequest>{approval.requests.map((request) => request.toolName).join(', ')}</ConfirmationRequest>
        <details className="mt-2 text-xs text-(--muted)">
          <summary className="cursor-pointer">Action details</summary>
          {approval.requests.map((request) => (
            <pre key={request.approvalId} className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify({ tool: request.toolName, input: request.input }, null, 2)}
            </pre>
          ))}
        </details>
        {submitted ? <p role="status" className="mt-2 text-xs text-(--muted)">Decision sent</p>
          : canApprove ? (
            <ConfirmationActions>
              <ConfirmationAction tone="primary" disabled={submitting} onClick={() => onSubmit(true)}>Approve</ConfirmationAction>
              <ConfirmationAction disabled={submitting} onClick={() => onSubmit(false)}>Deny</ConfirmationAction>
            </ConfirmationActions>
          ) : <p className="mt-2 text-xs text-(--muted)">Waiting for the person who started this run.</p>}
      </ConfirmationBody>
    </Confirmation>
  )
}
