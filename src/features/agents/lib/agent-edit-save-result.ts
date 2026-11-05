export type AgentEditSaveResult = 'saved' | 'cancelled' | 'conflict' | 'failed'

export function confirmComputerToolRemoval({
  shouldConfirm,
  confirm,
  revertToggle,
}: {
  shouldConfirm: boolean
  confirm(): boolean
  revertToggle(): void
}): 'confirmed' | 'cancelled' {
  if (!shouldConfirm || confirm()) return 'confirmed'
  revertToggle()
  return 'cancelled'
}

export function isAgentEditSaveFailure(result: AgentEditSaveResult): boolean {
  return result === 'failed' || result === 'conflict'
}

export function isAgentRevisionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('WORKSPACE_AGENT_REVISION_CONFLICT')
}
