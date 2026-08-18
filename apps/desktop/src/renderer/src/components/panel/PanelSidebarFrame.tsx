import type { CSSProperties, ReactNode } from 'react'
import type { PanelTheme } from '../../hooks/usePanelTheme'

interface PanelSidebarFrameProps {
  accessTabsInSidebar: boolean
  open: boolean
  closing?: boolean
  width: number
  defaultWidth?: number
  collapseThreshold?: number
  maxWidth?: number
  panelOpacity: number
  frameVisible: boolean
  theme: PanelTheme
  onRequestClose(): void
  onOpenChange(open: boolean): void
  onWidthChange(width: number): void
  children: ReactNode
}

export function PanelSidebarFrame({
  accessTabsInSidebar,
  open,
  closing = false,
  width,
  defaultWidth = 200,
  collapseThreshold = 80,
  maxWidth = 400,
  panelOpacity,
  frameVisible,
  theme,
  onRequestClose,
  onOpenChange,
  onWidthChange,
  children,
}: PanelSidebarFrameProps): React.ReactElement<any> | null {
  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    let currentWidth = startWidth

    const stopResize = (): void => {
      if (currentWidth <= collapseThreshold) {
        onOpenChange(false)
        onWidthChange(defaultWidth)
      }
      document.removeEventListener('mousemove', resize)
      document.removeEventListener('mouseup', stopResize)
    }

    const resize = (moveEvent: MouseEvent): void => {
      currentWidth = startWidth + moveEvent.clientX - startX
      if (currentWidth <= collapseThreshold) {
        onOpenChange(false)
        onWidthChange(defaultWidth)
        stopResize()
        return
      }
      onWidthChange(Math.min(maxWidth, currentWidth))
    }

    document.addEventListener('mousemove', resize)
    document.addEventListener('mouseup', stopResize)
  }

  if (accessTabsInSidebar) {
    return (
      <div
        className="relative shrink-0 overflow-hidden transition-[width] duration-300"
        style={{ width: open ? width : 0 }}
      >
        <aside
          className="flex h-full flex-col border-r"
          style={{
            width,
            background: theme.panelBgOpacity(panelOpacity),
            borderColor: theme.border,
            borderRadius: frameVisible ? '8px 0 0 8px' : 'var(--dockable-border-radius, 12px)',
          }}
        >
          {children}
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize"
          onMouseDown={startResize}
        />
      </div>
    )
  }

  if (!open && !closing) return null

  return (
    <>
      <button
        type="button"
        aria-label="Close sidebar"
        onClick={onRequestClose}
        className="absolute inset-0 z-40 cursor-default border-0 bg-black/30 backdrop-blur-sm"
        style={{
          opacity: closing ? 0 : 1,
          transition: 'opacity 0.15s ease-out',
        }}
      />
      <aside
        className="absolute inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r"
        style={
          {
            background: `linear-gradient(${theme.sidebarBg}, ${theme.sidebarBg}), ${theme.panelBg}`,
            borderColor: theme.border,
            animation: closing
              ? 'slideOut 0.15s ease-out forwards'
              : 'slideIn 0.15s ease-out',
          } as CSSProperties
        }
      >
        {children}
      </aside>
    </>
  )
}
