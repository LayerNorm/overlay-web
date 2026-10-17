'use client'

import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Button } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { useAgentRunLifecycle } from './useAgentRunLifecycle'

export function useWorkApproval({
  agentRunLifecycle,
  activeChatId,
  setComposerNotice,
}: {
  agentRunLifecycle: ReturnType<typeof useAgentRunLifecycle>
  activeChatId: string | null
  setComposerNotice: Dispatch<SetStateAction<string | null>>
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
      setComposerNotice(error instanceof Error ? error.message : 'Could not submit approval.')
    } finally {
      setApprovalSubmitting(false)
    }
  }, [activeChatId, agentRunLifecycle, setComposerNotice])

  const workApprovalContent = agentRunLifecycle.run?.status === 'waiting_for_approval' && agentRunLifecycle.run.approval
    ? (
        <div className="mb-2 rounded-2xl border border-(--border) bg-(--surface-elevated) px-4 py-3 shadow-xs">
          <p className="text-sm font-medium text-(--foreground)">{agentRunLifecycle.run.approval.title ?? 'Work needs your approval'}</p>
          <p className="mt-1 text-xs text-(--muted)">
            {agentRunLifecycle.run.approval.requests.map((request) => request.toolName).join(', ')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="primary"
              type="button"
              disabled={approvalSubmitting}
              onClick={() => void submitWorkApproval(true)}
              className="h-auto rounded-lg bg-(--foreground) px-3 py-1.5 text-xs font-medium text-(--background) disabled:opacity-50"
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={approvalSubmitting}
              onClick={() => void submitWorkApproval(false)}
              className="h-auto rounded-lg border border-(--border) px-3 py-1.5 text-xs font-medium text-(--foreground) hover:bg-transparent disabled:opacity-50"
            >
              Deny
            </Button>
          </div>
        </div>
      )
    : undefined

  return { workApprovalContent }
}
