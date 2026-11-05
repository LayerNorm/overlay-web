'use client'

import { useCallback, useRef, useState } from 'react'
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationBody, ConfirmationIcon, ConfirmationRequest, ConfirmationTitle } from '@overlay/chat-react'
import { toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { useAgentRunLifecycle } from './useAgentRunLifecycle'
import type { NativeRunCommandScope } from './native-personal-lifecycle'
import { RunInputRequest } from './RunInputRequest'
import { submitNativeRunApproval } from './native-work-command-actions'
import { useNativeWorkCommandState } from './useNativeWorkCommandState'

export function useWorkApproval({
  agentRunLifecycle,
  activeChatId,
  nativeScope,
}: {
  agentRunLifecycle: ReturnType<typeof useAgentRunLifecycle>
  activeChatId: string | null
  nativeScope?: NativeRunCommandScope
}) {
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)
  const latestRunRef = useRef(agentRunLifecycle.run)
  latestRunRef.current = agentRunLifecycle.run
  const nativeCommandState = useNativeWorkCommandState({
    run: agentRunLifecycle.run,
    activeChatId,
    scope: nativeScope,
  })
  const {
    inputRun, inputKey,
    setSubmittingKey: setNativeSubmittingKey, setApprovalConsumedKey,
    setInputConsumedKey, pendingRef: nativePendingRef,
    consumedRef: nativeConsumedRef, inputConsumedRef: nativeInputConsumedRef,
    inputConsumed, approvalAllowed, inputAllowed, approvalSubmitting: nativeApprovalSubmitting,
    approvalConsumed: nativeApprovalConsumed,
  } = nativeCommandState

  const submitWorkApproval = useCallback(async (approved: boolean) => {
    const run = agentRunLifecycle.run
    if (!activeChatId || !run?.approval || run.status !== 'waiting_for_approval') return
    if (nativeScope?.enabled) {
      await submitNativeRunApproval({
        approved,
        activeChatId,
        scope: nativeScope,
        run,
        pendingRef: nativePendingRef,
        consumedRef: nativeConsumedRef,
        setSubmittingKey: setNativeSubmittingKey,
        setConsumedKey: setApprovalConsumedKey,
        getLatestRun: () => latestRunRef.current,
        refresh: agentRunLifecycle.refresh,
      })
      return
    }
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
  }, [
    activeChatId,
    agentRunLifecycle,
    nativeConsumedRef,
    nativePendingRef,
    nativeScope,
    setApprovalSubmitting,
    setApprovalConsumedKey,
    setNativeSubmittingKey,
  ])

  const workApprovalContent = agentRunLifecycle.run?.status === 'waiting_for_approval' && agentRunLifecycle.run.approval
    ? (
        <Confirmation className="mb-2">
          <ConfirmationIcon running={approvalSubmitting || nativeApprovalSubmitting} />
          <ConfirmationBody>
            <ConfirmationTitle>{agentRunLifecycle.run.approval.title ?? 'Approval needed'}</ConfirmationTitle>
            <ConfirmationRequest>
              {agentRunLifecycle.run.approval.requests.map((request) => request.toolName).join(', ')}
            </ConfirmationRequest>
            <ConfirmationActions>
              <ConfirmationAction tone="primary" disabled={nativeScope?.enabled
                ? !approvalAllowed || nativeApprovalSubmitting || nativeApprovalConsumed
                : approvalSubmitting} onClick={() => void submitWorkApproval(true)}>
                Approve
              </ConfirmationAction>
              <ConfirmationAction disabled={nativeScope?.enabled
                ? !approvalAllowed || nativeApprovalSubmitting || nativeApprovalConsumed
                : approvalSubmitting} onClick={() => void submitWorkApproval(false)}>
                Deny
              </ConfirmationAction>
            </ConfirmationActions>
          </ConfirmationBody>
        </Confirmation>
      )
    : agentRunLifecycle.run?.status === 'waiting_for_input' && agentRunLifecycle.run.inputRequest && activeChatId
      ? (
          <RunInputRequest
            key={`${nativeScope?.enabled ? nativeScope.scopeKey : ''}:${agentRunLifecycle.run.id}:${agentRunLifecycle.run.inputRequest.token}`}
            conversationId={nativeScope?.enabled
              ? nativeScope.conversationId ?? activeChatId
              : activeChatId}
            runId={agentRunLifecycle.run.id}
            token={agentRunLifecycle.run.inputRequest.token}
            question={agentRunLifecycle.run.inputRequest.question}
            refresh={agentRunLifecycle.refresh}
            canRespond={!nativeScope?.enabled || inputAllowed}
            nativeScope={nativeScope}
            alreadySubmitted={inputConsumed}
            onSubmitted={() => {
              const current = latestRunRef.current
              if (nativeScope?.enabled && nativeScope.isCurrentScope()
                && current?.id === inputRun?.id
                && current?.inputRequest?.token === inputRun?.inputRequest?.token
                && current?.status === 'waiting_for_input'
                && inputKey) {
                nativeInputConsumedRef.current = inputKey
                setInputConsumedKey(inputKey)
              }
            }}
            isCurrentRequest={() => {
              const current = latestRunRef.current
              return !nativeScope?.enabled || (
                nativeScope.isCurrentScope()
                && current?.id === agentRunLifecycle.run?.id
                && current?.inputRequest?.token === agentRunLifecycle.run?.inputRequest?.token
                && current?.status === 'waiting_for_input'
              )
            }}
          />
        )
        : agentRunLifecycle.run?.status === 'waiting_for_authorization' && agentRunLifecycle.run.authorizationPause
          ? (
              <Confirmation className="mb-2">
                <ConfirmationIcon running={false} />
                <ConfirmationBody>
                  <ConfirmationTitle>Task authorization expired</ConfirmationTitle>
                  <ConfirmationRequest>
                    The task reached its explicit deadline. Progress is saved; further execution requires new authorization.
                  </ConfirmationRequest>
                </ConfirmationBody>
              </Confirmation>
            )
        : agentRunLifecycle.run?.status === 'waiting_for_resources' && agentRunLifecycle.run.fundingPause
        ? (
            <Confirmation className="mb-2">
              <ConfirmationIcon running={false} />
              <ConfirmationBody>
                <ConfirmationTitle>Waiting for workspace funding</ConfirmationTitle>
                <ConfirmationRequest>
                  {`This task needs $${(agentRunLifecycle.run.fundingPause.requiredCents / 100).toFixed(2)}. `
                    + `$${(agentRunLifecycle.run.fundingPause.availableCents / 100).toFixed(2)} is available. `
                    + (agentRunLifecycle.run.fundingPause.reservedCents !== undefined
                      ? `$${(agentRunLifecycle.run.fundingPause.reservedCents / 100).toFixed(2)} is reserved. `
                      : 'The reserved amount is unavailable. ')
                    + `Funding status: ${agentRunLifecycle.run.fundingPause.autoTopUpReason
                      ?? agentRunLifecycle.run.fundingPause.reason.replaceAll('_', ' ')}.`}
                </ConfirmationRequest>
              </ConfirmationBody>
            </Confirmation>
          )
        : undefined

  return { workApprovalContent }
}
