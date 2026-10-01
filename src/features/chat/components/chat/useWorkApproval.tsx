'use client'

import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
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
        <div className="mb-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 shadow-sm">
          <p className="text-sm font-medium text-[var(--foreground)]">{agentRunLifecycle.run.approval.title ?? 'Work needs your approval'}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {agentRunLifecycle.run.approval.requests.map((request) => request.toolName).join(', ')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={approvalSubmitting}
              onClick={() => void submitWorkApproval(true)}
              className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={approvalSubmitting}
              onClick={() => void submitWorkApproval(false)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </div>
      )
    : undefined

  return { workApprovalContent }
}
