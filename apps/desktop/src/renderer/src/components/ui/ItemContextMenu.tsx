import { useEffect } from 'react'
import type { PanelTheme } from '../../hooks/usePanelTheme'

export interface ContextMenuPosition {
  x: number
  y: number
}

export interface ItemContextMenuProps {
  position: ContextMenuPosition
  theme: PanelTheme
  onRename: () => void
  onOpenInCurrentTab: () => void
  onOpenInNewTab: () => void
  onOpenInNewWindow: () => void
  onDelete: () => void
  onClose: () => void
  hideRename?: boolean
  hideDelete?: boolean
}

export function ItemContextMenu({
  onRename,
  onOpenInCurrentTab,
  onOpenInNewTab,
  onOpenInNewWindow,
  onDelete,
  onClose,
  hideRename = false,
  hideDelete = false
}: ItemContextMenuProps): null {
  useEffect(() => {
    const showMenu = async (): Promise<void> => {
      const items = [
        ...(hideRename ? [] : [{ id: 'rename', label: 'Rename' }]),
        { id: 'open-current', label: 'Open in Current Tab' },
        { id: 'open-new-tab', label: 'Open in New Tab' },
        { id: 'open-new-window', label: 'Open in New Window' },
        ...(hideDelete
          ? []
          : [
              { id: 'separator', label: '', type: 'separator' as const },
              { id: 'delete', label: 'Delete' }
            ])
      ]

      try {
        const result = await window.bridge.showContextMenu(items)

        if (result.clicked) {
          switch (result.clicked) {
            case 'rename':
              onRename()
              break
            case 'open-current':
              onOpenInCurrentTab()
              break
            case 'open-new-tab':
              onOpenInNewTab()
              break
            case 'open-new-window':
              onOpenInNewWindow()
              break
            case 'delete':
              onDelete()
              break
          }
        }
      } catch (error) {
        console.error('Failed to show context menu:', error)
      }

      onClose()
    }

    showMenu()
  }, [onRename, onOpenInCurrentTab, onOpenInNewTab, onOpenInNewWindow, onDelete, onClose, hideRename, hideDelete])

  return null
}
