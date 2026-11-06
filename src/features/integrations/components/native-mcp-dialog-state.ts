import type { NativeMcpSummary } from '../hooks/use-native-mcp-servers'

export type NativeMcpDialogState = {
  mode: 'create' | 'edit'
  createdId?: string
  persistedId?: string
  createEndpoint?: string
  snapshot?: NativeMcpSummary
  missing?: boolean
}

export const MCP_DIALOG_WAITING_MESSAGE =
  'This MCP server is saved; waiting for its settings to sync. Please wait before saving or connecting.'
export const MCP_DIALOG_LOADING_MESSAGE = 'Loading this MCP server settings. Please wait before continuing.'
export const MCP_DIALOG_MISSING_MESSAGE =
  'This MCP server was removed or is no longer accessible. Reopen settings to continue.'
export const MCP_DIALOG_STALE_MESSAGE =
  'This MCP server changed while you were editing. Reopen it to review the latest settings.'

export function nativeMcpDialogServerId(dialog: NativeMcpDialogState | null): string | undefined {
  return dialog?.persistedId ?? dialog?.createdId
}

export function captureNativeMcpSnapshot(
  dialog: NativeMcpDialogState,
  server: NativeMcpSummary | null,
): NativeMcpDialogState {
  const id = nativeMcpDialogServerId(dialog)
  if (!id) return dialog
  if (!server) {
    return { ...dialog, mode: 'edit', persistedId: dialog.persistedId ?? id, missing: true }
  }
  if (dialog.snapshot) return dialog
  return {
    ...dialog,
    mode: 'edit',
    persistedId: id,
    snapshot: server,
    missing: false,
  }
}

export function retainCreatedNativeMcpServer(
  dialog: NativeMcpDialogState | null,
  createdId: string,
  endpoint: string,
): NativeMcpDialogState | null {
  if (!dialog || dialog.mode !== 'create' || dialog.createdId) return dialog
  return { ...dialog, createdId, createEndpoint: endpoint }
}

export function nativeMcpDialogProblem(
  dialog: NativeMcpDialogState | null,
  liveServer: NativeMcpSummary | null | undefined,
): string | null {
  if (!dialog) return null
  const id = nativeMcpDialogServerId(dialog)
  if (!id) return null
  if (dialog.missing || liveServer === null) return MCP_DIALOG_MISSING_MESSAGE
  if (!dialog.snapshot) {
    return dialog.createdId ? MCP_DIALOG_WAITING_MESSAGE : MCP_DIALOG_LOADING_MESSAGE
  }
  if (!liveServer) return MCP_DIALOG_LOADING_MESSAGE
  if (liveServer.updatedAt !== dialog.snapshot.updatedAt) return MCP_DIALOG_STALE_MESSAGE
  return null
}
