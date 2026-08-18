import { useState } from 'react'
import { Settings } from '../../hooks/useSettings'
import { Theme } from '../../utils/theme'

interface BrowserSettingsProps {
  settings: Settings
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  theme: Theme
}

type ActionState = 'idle' | 'confirm' | 'done'

const BOOKMARKS_STORAGE_KEY = 'browser-bookmarks'

interface ActionRowProps {
  theme: Theme
  label: string
  description: string
  state: ActionState
  onRequest: () => void
  onConfirm: () => void
  onCancel: () => void
}

function ActionRow({
  theme,
  label,
  description,
  state,
  onRequest,
  onConfirm,
  onCancel
}: ActionRowProps): React.ReactElement<any> {
  const isDark = theme.isDark

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 0',
    borderBottom: `1px solid ${theme.border}`,
    gap: 16
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 500,
    color: theme.text,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    marginBottom: 2
  }

  const descStyle: React.CSSProperties = {
    fontSize: 12,
    color: theme.textSecondary,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
  }

  const baseBtn: React.CSSProperties = {
    padding: '6px 14px',
    borderRadius: 8,
    border: 'none',
    fontSize: 13,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    cursor: 'pointer',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    background: 'transparent',
    textDecoration: 'underline',
    textDecorationThickness: '2px',
    textUnderlineOffset: '3px',
    transition: 'background 0.15s ease'
  }

  const destructiveBtn: React.CSSProperties = {
    ...baseBtn,
    color: isDark ? '#f87171' : '#dc2626'
  }

  const secondaryBtn: React.CSSProperties = {
    ...baseBtn,
    color: theme.textSecondary
  }

  const doneBtn: React.CSSProperties = {
    ...baseBtn,
    color: isDark ? '#4ade80' : '#16a34a'
  }

  return (
    <div style={rowStyle}>
      <div>
        <div style={labelStyle}>{label}</div>
        <div style={descStyle}>{description}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {state === 'idle' && (
          <button
            style={destructiveBtn}
            onClick={onRequest}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            Clear
          </button>
        )}
        {state === 'confirm' && (
          <>
            <button
              style={secondaryBtn}
              onClick={onCancel}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme.border
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              Cancel
            </button>
            <button
              style={destructiveBtn}
              onClick={onConfirm}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme.border
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              Confirm
            </button>
          </>
        )}
        {state === 'done' && <button style={doneBtn}>Cleared ✓</button>}
      </div>
    </div>
  )
}

export function BrowserSettings({
  settings: _settings,
  onUpdateSetting: _onUpdateSetting,
  theme
}: BrowserSettingsProps): React.ReactElement<any> {
  const [historyState, setHistoryState] = useState<ActionState>('idle')
  const [cookiesState, setCookiesState] = useState<ActionState>('idle')
  const [bookmarksState, setBookmarksState] = useState<ActionState>('idle')

  const handleClearHistory = async (): Promise<void> => {
    await window.bridge.browser.clearHistory()
    setHistoryState('done')
    setTimeout(() => setHistoryState('idle'), 3000)
  }

  const handleClearCookies = async (): Promise<void> => {
    await window.bridge.browser.clearAllCookies()
    setCookiesState('done')
    setTimeout(() => setCookiesState('idle'), 3000)
  }

  const handleClearBookmarks = (): void => {
    localStorage.removeItem(BOOKMARKS_STORAGE_KEY)
    setBookmarksState('done')
    setTimeout(() => setBookmarksState('idle'), 3000)
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <ActionRow
        theme={theme}
        label="Clear History"
        description="Remove all visited pages and URLs from browser history."
        state={historyState}
        onRequest={() => setHistoryState('confirm')}
        onConfirm={handleClearHistory}
        onCancel={() => setHistoryState('idle')}
      />
      <ActionRow
        theme={theme}
        label="Clear Cookies"
        description="Delete all cookies and site data stored by websites."
        state={cookiesState}
        onRequest={() => setCookiesState('confirm')}
        onConfirm={handleClearCookies}
        onCancel={() => setCookiesState('idle')}
      />
      <ActionRow
        theme={theme}
        label="Clear Bookmarks"
        description="Remove all saved bookmarks."
        state={bookmarksState}
        onRequest={() => setBookmarksState('confirm')}
        onConfirm={handleClearBookmarks}
        onCancel={() => setBookmarksState('idle')}
      />
    </div>
  )
}
