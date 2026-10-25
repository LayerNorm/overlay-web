import { logger } from '@/server/observability/logger'
import { COMPUTER_TOOL_IDS } from '@/shared/agents/tool-groups'
import { summarizeErrorForLog } from '@/shared/security/safe-log'

type ActMode = 'chat' | 'automate'

export async function withPersonalComputerToolIds(
  toolIds: readonly string[],
  params: {
    userId: string
    workspaceId?: string
    agentId?: string
    computerApprovalContext?: 'work' | 'automation'
    automationExecution?: boolean
    automationMode?: boolean
    mode?: ActMode
    findPersonalComputer: (workspaceId: string, userId: string) => Promise<unknown | null>
  },
): Promise<string[]> {
  if (
    !params.workspaceId
    || params.agentId !== undefined
    || params.computerApprovalContext !== 'work'
    || params.automationExecution
    || params.automationMode
    || params.mode === 'automate'
  ) {
    return [...toolIds]
  }
  try {
    const computer = await params.findPersonalComputer(params.workspaceId, params.userId)
    return computer
      ? [...new Set([...toolIds, ...COMPUTER_TOOL_IDS])]
      : [...toolIds]
  } catch (error) {
    logger.warn(
      '[conversations/act] personal Computer lookup failed:',
      summarizeErrorForLog(error),
    )
    return [...toolIds]
  }
}
