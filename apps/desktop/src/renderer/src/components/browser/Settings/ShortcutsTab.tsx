import { ReactElement } from 'react'
import { Theme } from '../types'

interface ShortcutsTabProps {
  theme: Theme
}

const SHORTCUTS = [
  { keys: ['⌘', 'T'], desc: 'New tab' },
  { keys: ['⌘', 'W'], desc: 'Close tab' },
  { keys: ['⌘', '⇧', 'T'], desc: 'Reopen closed tab' },
  { keys: ['⌘', 'L'], desc: 'Focus address bar' },
  { keys: ['⌘', 'R'], desc: 'Reload' },
  { keys: ['⌘', '⇧', 'R'], desc: 'Hard reload' },
  { keys: ['⌘', 'F'], desc: 'Find in page' },
  { keys: ['⌘', '['], desc: 'Go back' },
  { keys: ['⌘', ']'], desc: 'Go forward' },
  { keys: ['⌘', '⇧', '['], desc: 'Previous tab' },
  { keys: ['⌘', '⇧', ']'], desc: 'Next tab' },
  { keys: ['⌘', '1-8'], desc: 'Switch to tab N' },
  { keys: ['⌘', '9'], desc: 'Switch to last tab' },
  { keys: ['⌘', '↵'], desc: 'Open URL in new tab' },
  { keys: ['Esc'], desc: 'Stop loading / Cancel' },
  { keys: ['⌘', '⇧', '/'], desc: 'Show shortcuts' },
  { keys: ['⌘', '+'], desc: 'Zoom in' },
  { keys: ['⌘', '-'], desc: 'Zoom out' },
  { keys: ['⌘', '0'], desc: 'Reset zoom' }
]

export function ShortcutsTab({ theme }: ShortcutsTabProps): ReactElement<any> {
  return (
    <div style={{ maxWidth: 500 }}>
      <h2
        style={{
          margin: '0 0 24px',
          fontSize: 18,
          fontWeight: 600,
          color: theme.text,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
        }}
      >
        Keyboard Shortcuts
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SHORTCUTS.map((shortcut, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 0'
            }}
          >
            <span
              style={{
                fontSize: 14,
                color: theme.text,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
              }}
            >
              {shortcut.desc}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {shortcut.keys.map((key, j) => (
                <kbd
                  key={j}
                  style={{
                    padding: '4px 8px',
                    fontSize: 12,
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 4,
                    color: theme.text,
                    fontFamily: 'system-ui'
                  }}
                >
                  {key}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
