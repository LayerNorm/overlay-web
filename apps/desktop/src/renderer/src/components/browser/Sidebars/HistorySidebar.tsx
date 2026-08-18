import { ReactElement } from 'react'
import { X } from 'lucide-react'
import { HistoryEntry, Theme } from '../types'

interface HistorySidebarProps {
  history: HistoryEntry[]
  theme: Theme
  onClose: () => void
  onClear: () => void
  onOpenUrl: (url: string) => void
}

export function HistorySidebar({
  history,
  theme,
  onClose,
  onClear,
  onOpenUrl
}: HistorySidebarProps): ReactElement<any> {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 280,
        background: theme.background,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        zIndex: 50,
        animation: 'slideInRight 0.15s ease-out'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px'
        }}
      >
        <span style={{ fontWeight: 600, color: theme.text, fontSize: 13 }}>History</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClear}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: 'none',
              background: theme.background,
              color: theme.textSecondary,
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            Clear
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={14} color={theme.textSecondary} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {history.map((entry) => (
          <div
            key={entry.id}
            onClick={() => onOpenUrl(entry.url)}
            style={{
              padding: '10px 24px',
              cursor: 'pointer'
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: theme.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {entry.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: theme.textSecondary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {entry.url}
            </div>
          </div>
        ))}
        {history.length === 0 && (
          <div
            style={{
              padding: 16,
              color: theme.textSecondary,
              textAlign: 'center',
              fontSize: 13
            }}
          >
            No history yet
          </div>
        )}
      </div>
    </div>
  )
}
