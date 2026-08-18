import { ReactElement } from 'react'
import { X } from 'lucide-react'
import { BrowserTab, Theme } from '../types'

interface TabProps {
  tab: BrowserTab
  isActive: boolean
  theme: Theme
  index: number
  onSelect: () => void
  onClose: () => void
  onDragStart: (e: React.DragEvent, index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (index: number) => void
  onDragEnd: () => void
  isDragging: boolean
  dragIndex: number | null
  dragOverIndex: number | null
}

export function Tab({
  tab,
  isActive,
  theme,
  index,
  onSelect,
  onClose,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  dragIndex,
  dragOverIndex
}: TabProps): ReactElement<any> {
  const isDropTarget = dragOverIndex === index
  // Determine which side to show the drop indicator
  const showLeftIndicator = isDropTarget && dragIndex !== null && dragIndex > index
  const showRightIndicator = isDropTarget && dragIndex !== null && dragIndex < index

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={`browser-tab ${isActive ? 'browser-tab-active' : ''}`}
      style={
        {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px 8px 12px',
          borderRadius: '6px 6px 0 0',
          background: isActive ? theme.selectionBg : 'transparent',
          borderTop: isActive
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
      {tab.favicon && (
        <img
          src={tab.favicon}
          alt=""
          style={{
            width: 16,
            height: 16,
            flexShrink: 0,
            borderRadius: 2
          }}
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      )}
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
        {tab.title || 'New Tab'}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="browser-tab-close"
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
}
