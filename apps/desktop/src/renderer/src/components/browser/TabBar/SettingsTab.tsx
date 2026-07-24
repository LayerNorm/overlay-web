import { ReactElement } from 'react'
import { Settings, X } from 'lucide-react'
import { Theme } from '../types'

interface SettingsTabProps {
  isActive: boolean
  theme: Theme
  onSelect: () => void
  onClose: () => void
}

export function SettingsTab({
  isActive,
  theme,
  onSelect,
  onClose
}: SettingsTabProps): ReactElement {
  return (
    <div
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
          borderTop: isActive ? `2px solid rgba(255, 255, 255, 0.3)` : '2px solid transparent',
          borderLeft: '1px solid transparent',
          borderRight: '1px solid transparent',
          borderBottom: '1px solid transparent',
          cursor: 'pointer',
          width: 160,
          minWidth: 160,
          maxWidth: 160,
          height: 32,
          boxSizing: 'border-box',
          WebkitAppRegion: 'no-drag',
          transition: 'background 0.15s ease'
        } as React.CSSProperties
      }
    >
      <Settings size={16} color={theme.text} />
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
        Settings
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
