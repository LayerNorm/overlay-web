interface PanelFrameBorderProps {
  visible: boolean
  color: string
}

export function PanelFrameBorder({
  visible,
  color,
}: PanelFrameBorderProps): React.ReactElement | null {
  if (!visible) return null
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 200,
        pointerEvents: 'none',
        border: `1px solid ${color}`,
        borderRadius: 'var(--dockable-border-radius, 12px)',
        boxSizing: 'border-box',
      }}
    />
  )
}
