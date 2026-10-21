import type { AgentRunResource } from '@overlay/api-client'
import { isTerminalAgentRunStatus } from '@/shared/agents/agent-run'

export type AgentRunNoticePrevious = Pick<AgentRunResource, 'id' | 'status'>

type AgentRunNoticeRun = Pick<AgentRunResource, 'id' | 'status' | 'terminalError'>

export function resolveAgentRunNotice(
  previous: AgentRunNoticePrevious | null,
  run: AgentRunNoticeRun | null,
): { notice: string | null; announce: boolean } {
  const notice = run?.status === 'failed'
    ? `Work failed: ${run.terminalError?.message ?? 'The run could not be completed.'}`
    : run?.status === 'cancelled'
      ? 'Work stopped.'
      : null
  const announce = Boolean(
    notice &&
    previous &&
    run &&
    previous.id === run.id &&
    !isTerminalAgentRunStatus(previous.status),
  )

  return { notice, announce }
}
