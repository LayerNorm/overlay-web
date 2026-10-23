export type AgentEditSaveResult = 'saved' | 'cancelled' | 'failed'

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
  return result === 'failed'
}
