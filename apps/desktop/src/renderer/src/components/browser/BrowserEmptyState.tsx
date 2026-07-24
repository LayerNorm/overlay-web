import { ReactElement, useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Globe, Clock, Plus } from 'lucide-react'
import { Theme, HistoryEntry } from './types'

interface BrowserEmptyStateProps {
  theme: Theme
  embedded: boolean
  onCreateTab: (url?: string) => void
}

function getFaviconUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`
  } catch {
    return ''
  }
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function BrowserEmptyState({
  theme,
  embedded,
  onCreateTab
}: BrowserEmptyStateProps): ReactElement {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [inputUrl, setInputUrl] = useState('')
  const [isUrlFocused, setIsUrlFocused] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.bridge.browser.getHistory().then((h) => setHistory((h as HistoryEntry[]).slice(0, 12)))
  }, [])

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent): void => {
      e.preventDefault()
      const trimmed = inputUrl.trim()
      if (!trimmed) {
        onCreateTab()
        return
      }
      let targetUrl = trimmed
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
          targetUrl = 'https://' + targetUrl
        } else {
          targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`
        }
      }
      onCreateTab(targetUrl)
    },
    [inputUrl, onCreateTab]
  )

  const handleUrlKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        const trimmed = inputUrl.trim()
        if (trimmed) onCreateTab(trimmed)
      }
    },
    [inputUrl, onCreateTab]
  )

  const recentHistory = history.slice(0, 8)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: theme.background,
        borderRadius: embedded ? 0 : 'var(--dockable-border-radius, 12px)',
        overflow: 'hidden'
      }}
    >
      {/* Tab bar with single non-closable "New Tab" — hidden in embedded mode,
          where the main window sidebar list already represents the tab */}
      {!embedded && (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '4px 8px 0 8px',
          flexShrink: 0
        }}
      >
        <div style={{ width: 52, flexShrink: 0 }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px 8px 12px',
            borderRadius: '6px 6px 0 0',
            background: theme.surface,
            borderTop: `2px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)'}`,
            borderBottom: '1px solid transparent',
            width: 160,
            minWidth: 160,
            maxWidth: 160,
            height: 32,
            boxSizing: 'border-box',
            cursor: 'default'
          }}
        >
          <Globe size={14} color={theme.textSecondary} />
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
            New Tab
          </span>
        </div>
        <button
          onClick={() => onCreateTab()}
          title="New tab"
          style={{
            width: 28,
            height: 32,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <Plus size={16} color={theme.textSecondary} />
        </button>
      </div>
      )}

      {/* Toolbar with URL bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '44px',
          gap: 8,
          padding: '0 12px',
          background: theme.background,
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0
        }}
      >
        <button
          disabled
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.3,
            cursor: 'default'
          }}
        >
          <ArrowLeft size={16} color={theme.text} />
        </button>
        <button
          disabled
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.3,
            cursor: 'default'
          }}
        >
          <ArrowRight size={16} color={theme.text} />
        </button>
        <button
          disabled
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.3,
            cursor: 'default'
          }}
        >
          <RotateCw size={14} color={theme.text} />
        </button>

        <form
          onSubmit={handleUrlSubmit}
          style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}
        >
          <input
            ref={urlInputRef}
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onFocus={(e) => {
              setIsUrlFocused(true)
              e.target.select()
            }}
            onBlur={() => setIsUrlFocused(false)}
            onKeyDown={handleUrlKeyDown}
            placeholder="Search or enter URL"
            style={{
              width: '100%',
              height: 32,
              padding: '0 12px',
              borderRadius: 8,
              border: `1px solid ${theme.border}`,
              background: theme.surface,
              color: theme.text,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              outline: isUrlFocused ? `1px solid ${theme.textSecondary}` : 'none',
              caretColor: theme.text,
              boxSizing: 'border-box'
            }}
          />
        </form>
      </div>

      {/* Content area — recently visited websites */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '32px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 640,
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: theme.textSecondary,
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
            }}
          >
            <Clock size={14} color={theme.textSecondary} />
            Recently Visited
          </div>

          {recentHistory.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 12
              }}
            >
              {recentHistory.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onCreateTab(entry.url)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: '16px 12px',
                    borderRadius: 12,
                    border: `1px solid ${theme.border}`,
                    background: theme.surface,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    textAlign: 'center'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = theme.textSecondary
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = theme.border
                  }}
                >
                  <img
                    src={entry.favicon || getFaviconUrl(entry.url)}
                    alt=""
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      flexShrink: 0
                    }}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      const fallback = target.nextElementSibling as HTMLElement | null
                      if (fallback) fallback.style.display = 'flex'
                    }}
                  />
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: theme.isDark
                        ? 'rgba(255, 255, 255, 0.1)'
                        : 'rgba(0, 0, 0, 0.06)',
                      display: 'none',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <Globe size={16} color={theme.textSecondary} />
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                      color: theme.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      width: '100%'
                    }}
                  >
                    {entry.title || getHostname(entry.url)}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                      color: theme.textSecondary,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      width: '100%'
                    }}
                  >
                    {getHostname(entry.url)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: '48px 16px',
                textAlign: 'center',
                color: theme.textSecondary,
                fontSize: 13,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
              }}
            >
              No recent history. Type a URL above or click the + to open a new tab.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
