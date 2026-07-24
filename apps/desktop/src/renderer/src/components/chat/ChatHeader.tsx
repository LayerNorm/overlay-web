import { useState, useRef, useEffect } from 'react'
import { Eye, EyeOff, Plus, Keyboard, X, Lock, Unlock, PanelLeft } from 'lucide-react'
import { PanelTheme } from '../../hooks/usePanelTheme'
import { TrafficLightButtons } from '../ui/TrafficLightButtons'
import { useDockableDrag } from '../DockablePanelContext'
import './ChatHeader.css'

export interface Tab {
  id: string
  title: string
  type?: 'chat' | 'folder'
  folderId?: string
}

interface ChatHeaderProps {
  isProtected: boolean
  toggleContentProtection: () => void
  onNewInNewTab: () => void
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
  isMaximized: boolean
  onShowShortcuts: () => void
  theme: PanelTheme
  tabs: Tab[]
  activeTabId: string | null
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onRenameTab: (tabId: string, newTitle: string) => void
  onReorderTabs: (fromIndex: number, toIndex: number) => void
  chatTitle: string
  setChatTitle: (title: string) => void
  isEditingTitle: boolean
  setIsEditingTitle: (editing: boolean) => void
  showSidebar?: boolean
  onToggleSidebar?: () => void
  headerLocked?: boolean
  onToggleHeaderLock?: () => void
  isPanelHovered?: boolean
}

export function ChatHeader({
  isProtected,
  toggleContentProtection,
  onNewInNewTab,
  onClose,
  onMinimize,
  onMaximize,
  isMaximized,
  onShowShortcuts,
  theme,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onReorderTabs,
  chatTitle,
  setChatTitle,
  isEditingTitle,
  setIsEditingTitle,
  showSidebar,
  onToggleSidebar,
  headerLocked,
  onToggleHeaderLock,
  isPanelHovered
}: ChatHeaderProps): React.ReactElement {
  const { startDrag } = useDockableDrag()

  // Only start drag when clicking on the tab bar background, not on interactive children
  const handleTabBarMouseDown = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement
    if (target.closest('button, input, [role="button"], .chat-tab')) return
    startDrag(e)
  }
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTabTitle, setEditingTabTitle] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [availableWidth, setAvailableWidth] = useState(9999)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const tabInputRef = useRef<HTMLInputElement>(null)
  const tabsContainerRef = useRef<HTMLDivElement>(null)

  // Measure available width for tabs via ResizeObserver
  useEffect(() => {
    const el = tabsContainerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setAvailableWidth(entry.contentRect.width)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const TAB_WIDTH = 160
  const TAB_GAP = 2
  const maxVisible = Math.max(1, Math.floor(availableWidth / (TAB_WIDTH + TAB_GAP)))
  const activeIndex = tabs.findIndex((t) => t.id === activeTabId)
  const windowStart = activeIndex >= maxVisible ? activeIndex - maxVisible + 1 : 0
  const visibleTabs = tabs.slice(windowStart, windowStart + maxVisible)

  // Focus title input when editing starts
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditingTitle])

  // Focus tab input when editing starts
  useEffect(() => {
    if (editingTabId && tabInputRef.current) {
      tabInputRef.current.focus()
      tabInputRef.current.select()
    }
  }, [editingTabId])

  const handleTitleBlur = (): void => {
    setIsEditingTitle(false)
    if (!chatTitle.trim()) {
      setChatTitle('New Chat')
    }
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      setIsEditingTitle(false)
      if (!chatTitle.trim()) {
        setChatTitle('New Chat')
      }
    }
  }

  const handleTabDoubleClick = (tab: Tab): void => {
    setEditingTabId(tab.id)
    setEditingTabTitle(tab.title || 'New Chat')
  }

  const handleTabTitleSave = (): void => {
    if (editingTabId) {
      const newTitle = editingTabTitle.trim() || 'New Chat'
      onRenameTab(editingTabId, newTitle)
      setEditingTabId(null)
      setEditingTabTitle('')
    }
  }

  const handleTabTitleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleTabTitleSave()
    } else if (e.key === 'Escape') {
      setEditingTabId(null)
      setEditingTabTitle('')
    }
  }

  // Tab drag handlers
  const handleDragStart = (e: React.DragEvent, index: number): void => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: React.DragEvent, index: number): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDrop = (toIndex: number): void => {
    if (dragIndex !== null && dragIndex !== toIndex) {
      onReorderTabs(dragIndex, toIndex)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = (): void => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        opacity: !headerLocked && !isPanelHovered ? 0 : 1,
        transition: 'opacity 0.2s ease-out',
        pointerEvents: !headerLocked && !isPanelHovered ? ('none' as const) : ('auto' as const)
      }}
    >
      {/* Tab Bar Row - Browser-style */}
      <div
        onMouseDown={handleTabBarMouseDown}
        style={
          {
            display: 'flex',
            alignItems: 'stretch',
            padding: '4px 8px 0 8px',
            background: 'transparent',
            WebkitAppRegion: 'no-drag',
            position: 'relative'
          } as React.CSSProperties
        }
      >
        {/* Left anchored section - Traffic Light Buttons + Sidebar toggle */}
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, paddingBottom: 4 }}>
          <TrafficLightButtons
            panelType="chat"
            onClose={onClose}
            onMinimize={onMinimize}
            onMaximize={onMaximize}
            isMaximized={isMaximized}
          />
          <div style={{ width: 4 }} />
          <button
            onClick={onToggleSidebar}
            title="Toggle sidebar"
            style={
              {
                width: 28,
                height: 28,
                borderRadius: 6,
                border: 'none',
                background: showSidebar ? theme.surfaceBgActive : 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                WebkitAppRegion: 'no-drag'
              } as React.CSSProperties
            }
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.surfaceBgActive
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = showSidebar ? theme.surfaceBgActive : 'transparent'
            }}
          >
            <PanelLeft size={14} color={theme.textSecondary} />
          </button>
          <div style={{ width: 4 }} />
        </div>

        {/* Tabs section - non-scrollable, width-limited */}
        <div
          ref={tabsContainerRef}
          className="chat-tabs-scroll"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flex: 1,
            overflow: 'hidden',
            minWidth: 0
          }}
        >
          {/* Tabs */}
          {visibleTabs.map((tab, index) => {
            const isActive = tab.id === activeTabId
            const isEditing = editingTabId === tab.id
            const isDragging = dragIndex === index
            const isDropTarget = dragOverIndex === index
            const showLeftIndicator = isDropTarget && dragIndex !== null && dragIndex > index
            const showRightIndicator = isDropTarget && dragIndex !== null && dragIndex < index
            return (
              <div
                key={tab.id}
                draggable={!isEditing}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                onClick={() => !isEditing && onSelectTab(tab.id)}
                onDoubleClick={() => handleTabDoubleClick(tab)}
                className={`chat-tab ${isActive ? 'chat-tab-active' : ''}`}
                style={
                  {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px 8px 12px',
                    borderRadius: '6px 6px 0 0',
                    background: isActive && !showSidebar ? theme.panelBg : 'transparent',
                    borderTop:
                      isActive && !showSidebar
                        ? `2px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)'}`
                        : '2px solid transparent',
                    borderLeft: showLeftIndicator
                      ? `2px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)'}`
                      : '1px solid transparent',
                    borderRight: showRightIndicator
                      ? `2px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)'}`
                      : '1px solid transparent',
                    borderBottom: '1px solid transparent',
                    cursor: 'default',
                    width: 160,
                    minWidth: 160,
                    maxWidth: 160,
                    height: 32,
                    boxSizing: 'border-box',
                    WebkitAppRegion: 'no-drag',
                    opacity: isDragging ? 0.5 : 1,
                    transition: 'background 0.15s ease, opacity 0.15s ease'
                  } as React.CSSProperties
                }
              >
                {isEditing ? (
                  <input
                    ref={tabInputRef}
                    type="text"
                    value={editingTabTitle}
                    onChange={(e) => setEditingTabTitle(e.target.value)}
                    onBlur={handleTabTitleSave}
                    onKeyDown={handleTabTitleKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      flex: 1,
                      padding: '2px 4px',
                      background: theme.inputBg,
                      border: `1px solid ${theme.inputBorderFocus}`,
                      borderRadius: 4,
                      color: theme.text,
                      fontSize: 12,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      fontWeight: 500,
                      outline: 'none'
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                      color: theme.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1,
                      userSelect: 'none'
                    }}
                  >
                    {tab.title || 'New Chat'}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  className="chat-tab-close"
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    opacity: isActive ? 1 : 0,
                    pointerEvents: isActive ? 'auto' : 'none'
                  }}
                >
                  <X size={12} color={theme.textSecondary} />
                </button>
              </div>
            )
          })}
        </div>

        {/* Right anchored section - Plus, Shortcuts, Eye, Lock buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            gap: 2,
            paddingBottom: 4,
            marginLeft: 4
          }}
        >
          {/* New Tab Button - always visible */}
          <button
            onClick={onNewInNewTab}
            style={
              {
                width: 28,
                height: 28,
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                WebkitAppRegion: 'no-drag',
                flexShrink: 0,
                marginRight: 6
              } as React.CSSProperties
            }
            title="New tab"
          >
            <Plus size={16} color={theme.textSecondary} />
          </button>
          {/* Shortcuts Button */}
          <button
            onClick={onShowShortcuts}
            title="Keyboard shortcuts (⌘L)"
            style={
              {
                width: 28,
                height: 28,
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                WebkitAppRegion: 'no-drag'
              } as React.CSSProperties
            }
          >
            <Keyboard size={16} color={theme.textSecondary} />
          </button>

          {/* Eye Button */}
          <button
            onClick={toggleContentProtection}
            title={isProtected ? 'Show in screenshots' : 'Hide from screenshots'}
            style={
              {
                width: 28,
                height: 28,
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                WebkitAppRegion: 'no-drag'
              } as React.CSSProperties
            }
          >
            {isProtected ? (
              <EyeOff size={16} color={theme.textSecondary} />
            ) : (
              <Eye size={16} color={theme.textSecondary} />
            )}
          </button>

          {/* Lock Button */}
          <button
            onClick={onToggleHeaderLock}
            title={
              headerLocked
                ? 'Unlock header (hide when not hovered)'
                : 'Lock header (always visible)'
            }
            style={
              {
                width: 28,
                height: 28,
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                WebkitAppRegion: 'no-drag'
              } as React.CSSProperties
            }
          >
            {headerLocked ? (
              <Lock size={16} color={theme.textSecondary} />
            ) : (
              <Unlock size={16} color={theme.textSecondary} />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
