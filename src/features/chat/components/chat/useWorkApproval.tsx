'use client'

import { useCallback, useState } from 'react'
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationBody, ConfirmationIcon, ConfirmationRequest, ConfirmationTitle } from '@overlay/chat-react'
import { toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { useAgentRunLifecycle } from './useAgentRunLifecycle'
import { RunInputRequest } from './RunInputRequest'

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
      : agentRunLifecycle.run?.status === 'waiting_for_resources' && agentRunLifecycle.run.fundingPause
        ? (
            <Confirmation className="mb-2">
              <ConfirmationIcon running={false} />
              <ConfirmationBody>
                <ConfirmationTitle>Waiting for workspace funding</ConfirmationTitle>
                <ConfirmationRequest>
                  {`This task needs $${(agentRunLifecycle.run.fundingPause.requiredCents / 100).toFixed(2)}. `
                    + `$${(agentRunLifecycle.run.fundingPause.availableCents / 100).toFixed(2)} is available and `
                    + `$${(agentRunLifecycle.run.fundingPause.reservedCents / 100).toFixed(2)} is reserved. `
                    + `Funding status: ${agentRunLifecycle.run.fundingPause.autoTopUpReason
                      ?? agentRunLifecycle.run.fundingPause.reason.replaceAll('_', ' ')}.`}
                </ConfirmationRequest>
              </ConfirmationBody>
            </Confirmation>
          )
        : undefined

  return { workApprovalContent }
}
