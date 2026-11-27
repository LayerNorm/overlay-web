import type { RoomConfirmation } from '../components/chat/RoomSheets'

/** The confirmation every "Move to workspace" goes through, as on the web (`MoveToWorkspaceDialog`). */
export function moveToWorkspaceConfirmation(name: string, run: () => void): RoomConfirmation {
  return {
    title: `Move “${name}” to workspace?`,
    message: 'Everyone in the workspace will be able to see and use it. You can’t move it back to Personal.',
    label: 'Move to workspace',
    run,
  }
}
