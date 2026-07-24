import type { Theme } from '../../utils/theme'

export function resolveSidebarListItemColors({
  theme,
  isActive,
  isBatchSelected,
  isSelectMode,
  isHovered
}: {
  theme: Theme
  isActive: boolean
  isBatchSelected: boolean
  isSelectMode: boolean
  isHovered: boolean
}): { background: string; foreground: string } {
  const selected = isActive || (isSelectMode && isBatchSelected)
  return {
    background: selected
      ? theme.selectionBg
      : isHovered
        ? theme.buttonHover
        : 'transparent',
    foreground: selected ? theme.selectionText : theme.textSecondary
  }
}
