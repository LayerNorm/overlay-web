import { ReactElement } from 'react'
import { HistoryEntry, Theme } from '../types'

interface HistoryTabProps {
  history: HistoryEntry[]
  theme: Theme
  onClear: () => void
  onOpenUrl: (url: string) => void
}

export function HistoryTab({ history, theme, onClear, onOpenUrl }: HistoryTabProps): ReactElement {
  return (
    <div style={{ maxWidth: 600 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: theme.text,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
          }}
        >
          History
        </h2>
        <button
          onClick={onClear}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: theme.surface,
            color: theme.text,
            fontSize: 13,
            cursor: 'pointer'
          }}
        >
          Clear All
        </button>
      </div>
      {history.length === 0 ? (
        <div
          style={{
            color: theme.textSecondary,
            fontSize: 14,
            textAlign: 'center',
            padding: 40,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
          }}
        >
          No history yet
        </div>
      ) : (
        history.slice(0, 50).map((entry) => (
          <div
            key={entry.id}
            onClick={() => onOpenUrl(entry.url)}
            style={{
              padding: '12px 0',
              cursor: 'pointer'
            }}
          >
            <div
              style={{
                fontSize: 14,
                color: theme.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
              }}
            >
              {entry.title}
            </div>
            <div
              style={{
                fontSize: 12,
                color: theme.textSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 4,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
              }}
            >
              {entry.url}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
