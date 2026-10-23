import type { Computer } from '@overlay/workspace-contracts'

export async function changeAgentComputerControl({ computer, userId, action, request }: {
  computer: Computer
  userId: string
  action: 'take' | 'release'
  request(workspaceId: string, computerId: string, action: 'take' | 'release'): Promise<{ computer: Computer }>
}): Promise<Computer> {
  const result = await request(computer.workspaceId, computer.id, action)
  const updated = result.computer
  if (updated.id !== computer.id || updated.workspaceId !== computer.workspaceId
    || (action === 'take' ? updated.controlledByUserId !== userId : Boolean(updated.controlledByUserId))) {
    throw new Error('Could not confirm computer control. Please try again.')
  }
  return updated
}
