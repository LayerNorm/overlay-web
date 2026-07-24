import { useEffect, useRef, ReactElement } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  Copy,
  Download,
  Search,
  Scissors,
  ClipboardPaste,
  Undo,
  Redo,
  CheckSquare,
  Save
} from 'lucide-react'

export interface ContextMenuParams {
  x: number
  y: number
  linkURL?: string
  linkText?: string
  srcURL?: string
  mediaType?: 'none' | 'image' | 'audio' | 'video' | 'canvas' | 'file' | 'plugin'
  hasImageContents?: boolean
  selectionText?: string
  isEditable?: boolean
  editFlags?: {
    canUndo: boolean
    canRedo: boolean
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canDelete: boolean
    canSelectAll: boolean
  }
  pageURL?: string
}

interface BrowserContextMenuProps {
  params: ContextMenuParams | null
  onClose: () => void
  onAction: (action: string, data?: unknown) => void
  canGoBack: boolean
  canGoForward: boolean
  theme: {
    background: string
    surface: string
    text: string
    textSecondary: string
    border: string
    accent: string
  }
}

interface MenuItem {
  id: string
  label: string
  icon?: typeof ArrowLeft
  shortcut?: string
  disabled?: boolean
  separator?: boolean
}

export function BrowserContextMenu({
  params,
  onClose,
  onAction,
  canGoBack,
  canGoForward,
  theme
}: BrowserContextMenuProps): ReactElement | null {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  if (!params) return null

  const menuItems: MenuItem[] = []

  // Link context
  if (params.linkURL) {
    menuItems.push(
      { id: 'open-link', label: 'Open Link', icon: ExternalLink },
      { id: 'open-link-new-tab', label: 'Open Link in New Tab', icon: ExternalLink },
      { id: 'copy-link', label: 'Copy Link Address', icon: Copy },
      { id: 'separator-1', label: '', separator: true }
    )
  }

  // Image context
  if (params.mediaType === 'image' && params.srcURL) {
    menuItems.push(
      { id: 'open-image', label: 'Open Image in New Tab', icon: ExternalLink },
      { id: 'save-image', label: 'Save Image As...', icon: Download },
      { id: 'copy-image', label: 'Copy Image', icon: Copy },
      { id: 'copy-image-url', label: 'Copy Image Address', icon: Copy },
      { id: 'separator-2', label: '', separator: true }
    )
  }

  // Selection context
  if (params.selectionText) {
    menuItems.push(
      { id: 'copy', label: 'Copy', icon: Copy, shortcut: '⌘C' },
      {
        id: 'search-selection',
        label: `Search Google for "${params.selectionText.slice(0, 20)}${params.selectionText.length > 20 ? '...' : ''}"`,
        icon: Search
      },
      { id: 'separator-3', label: '', separator: true }
    )
  }

  // Editable context
  if (params.isEditable && params.editFlags) {
    menuItems.push(
      {
        id: 'undo',
        label: 'Undo',
        icon: Undo,
        shortcut: '⌘Z',
        disabled: !params.editFlags.canUndo
      },
      {
        id: 'redo',
        label: 'Redo',
        icon: Redo,
        shortcut: '⇧⌘Z',
        disabled: !params.editFlags.canRedo
      },
      { id: 'separator-4', label: '', separator: true },
      {
        id: 'cut',
        label: 'Cut',
        icon: Scissors,
        shortcut: '⌘X',
        disabled: !params.editFlags.canCut
      },
      {
        id: 'copy-edit',
        label: 'Copy',
        icon: Copy,
        shortcut: '⌘C',
        disabled: !params.editFlags.canCopy
      },
      {
        id: 'paste',
        label: 'Paste',
        icon: ClipboardPaste,
        shortcut: '⌘V',
        disabled: !params.editFlags.canPaste
      },
      {
        id: 'select-all',
        label: 'Select All',
        icon: CheckSquare,
        shortcut: '⌘A',
        disabled: !params.editFlags.canSelectAll
      },
      { id: 'separator-5', label: '', separator: true }
    )
  }

  // Default page context (always show)
  if (!params.linkURL && !params.selectionText && params.mediaType !== 'image') {
    menuItems.push(
      { id: 'back', label: 'Back', icon: ArrowLeft, shortcut: '⌘[', disabled: !canGoBack },
      {
        id: 'forward',
        label: 'Forward',
        icon: ArrowRight,
        shortcut: '⌘]',
        disabled: !canGoForward
      },
      { id: 'reload', label: 'Reload', icon: RotateCw, shortcut: '⌘R' },
      { id: 'separator-6', label: '', separator: true }
    )
  }

  // Always add save page option
  menuItems.push({ id: 'save-page', label: 'Save Page As...', icon: Save })

  // Calculate position to keep menu in viewport
  let { x, y } = params
  const menuWidth = 220
  const menuHeight = menuItems.length * 32

  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 10
  }

  const handleItemClick = (item: MenuItem): void => {
    if (item.disabled || item.separator) return
    onAction(item.id, params)
    onClose()
  }

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: '4px 0',
        minWidth: 200,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
        zIndex: 1000,
        animation: 'fadeIn 0.1s ease-out'
      }}
    >
      {menuItems.map((item, index) =>
        item.separator ? (
          <div
            key={`sep-${index}`}
            style={{
              height: 1,
              background: theme.border,
              margin: '4px 8px'
            }}
          />
        ) : (
          <button
            key={item.id}
            onClick={() => handleItemClick(item)}
            disabled={item.disabled}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              border: 'none',
              background: 'transparent',
              cursor: item.disabled ? 'default' : 'pointer',
              opacity: item.disabled ? 0.4 : 1,
              color: theme.text,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              textAlign: 'left'
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                e.currentTarget.style.background = theme.background
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {item.icon && <item.icon size={14} color={theme.textSecondary} />}
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && (
              <span style={{ fontSize: 11, color: theme.textSecondary }}>{item.shortcut}</span>
            )}
          </button>
        )
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
