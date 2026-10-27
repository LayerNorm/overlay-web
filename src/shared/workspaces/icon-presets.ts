export const WORKSPACE_ICON_PRESETS = Array.from({ length: 6 }, (_, index) => ({
  id: `shape-${index + 1}`,
  url: `/assets/workspace-icons/shape-${index + 1}.svg`,
}))

export function workspaceIconUrl(workspace: { iconUrl?: string | null; iconPreset?: string | null }): string | undefined {
  return workspace.iconUrl || WORKSPACE_ICON_PRESETS.find((preset) => preset.id === workspace.iconPreset)?.url
}
