import { ReactElement, RefObject, useState, useEffect, useCallback } from 'react'
import { Theme, HistoryEntry } from '../types'

interface UrlBarProps {
  inputUrl: string
  isUrlFocused: boolean
  theme: Theme
  urlInputRef: RefObject<HTMLInputElement | null>
  onUrlChange: (url: string) => void
  onUrlSubmit: (e: React.FormEvent) => void
  onUrlFocus: (e: React.FocusEvent<HTMLInputElement>) => void
  onUrlBlur: () => void
  onUrlKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

// Cache for history to avoid repeated IPC calls
let historyCache: HistoryEntry[] = []
let historyCacheTime = 0
const CACHE_DURATION = 5000 // Refresh cache every 5 seconds

interface UrlParts {
  protocol: string
  domain: string
  path: string
}

function parseUrlParts(url: string): UrlParts | null {
  try {
    const parsed = new URL(url)
    const protocol = parsed.protocol + '//'
    const domain = parsed.hostname + (parsed.port ? ':' + parsed.port : '')
    const path = parsed.pathname + parsed.search + parsed.hash
    return { protocol, domain, path: path === '/' ? '' : path }
  } catch {
    return null
  }
}

export function UrlBar({
  inputUrl,
  isUrlFocused,
  theme,
  urlInputRef,
  onUrlChange,
  onUrlSubmit,
  onUrlFocus,
  onUrlBlur,
  onUrlKeyDown
}: UrlBarProps): ReactElement<any> {
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [userTypedValue, setUserTypedValue] = useState('')
  const urlParts = parseUrlParts(inputUrl)

  // Refresh history cache periodically
  const refreshHistoryCache = useCallback(async () => {
    const now = Date.now()
    if (now - historyCacheTime > CACHE_DURATION) {
      historyCache = await window.bridge.browser.getHistory()
      historyCacheTime = now
    }
  }, [])

  // Find matching suggestion from history
  const findSuggestion = useCallback((input: string): string | null => {
    if (!input || input.length < 2) return null
    const lowerInput = input.toLowerCase()
    
    // Search through history for matching URLs
    for (const entry of historyCache) {
      const url = entry.url.toLowerCase()
      // Check if URL contains the input (after protocol)
      const urlWithoutProtocol = url.replace(/^https?:\/\//, '').replace(/^www\./, '')
      if (urlWithoutProtocol.startsWith(lowerInput) || 
          urlWithoutProtocol.startsWith(lowerInput.replace(/^www\./, ''))) {
        // Return the completion part only
        const inputWithoutWww = lowerInput.replace(/^www\./, '')
        const matchStart = urlWithoutProtocol.indexOf(inputWithoutWww)
        if (matchStart === 0) {
          return entry.url.replace(/^https?:\/\//, '').replace(/^www\./, '').slice(input.replace(/^www\./, '').length);
        }
      }
    }
    return null
  }, [])

  // Update suggestion when input changes
  useEffect(() => {
    if (isUrlFocused && userTypedValue) {
      refreshHistoryCache().then(() => {
        const newSuggestion = findSuggestion(userTypedValue)
        setSuggestion(newSuggestion)
      })
    } else {
      setSuggestion(null)
    }
  }, [userTypedValue, isUrlFocused, refreshHistoryCache, findSuggestion])

  // Handle input change with suggestion tracking
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newValue = e.target.value
    setUserTypedValue(newValue)
    onUrlChange(newValue)
  }

  // Handle key events for autocomplete
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (suggestion) {
      // Accept suggestion on Tab or Enter
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (e.key === 'Tab') {
          e.preventDefault()
          const completedUrl = userTypedValue + suggestion
          setUserTypedValue(completedUrl)
          onUrlChange(completedUrl)
          setSuggestion(null)
          return
        }
        // For Enter, accept suggestion and submit
        if (e.key === 'Enter' && suggestion) {
          const completedUrl = userTypedValue + suggestion
          setUserTypedValue(completedUrl)
          onUrlChange(completedUrl)
          setSuggestion(null)
        }
      }
      // Clear suggestion on Escape
      if (e.key === 'Escape') {
        setSuggestion(null)
        return
      }
    }
    onUrlKeyDown(e)
  }

  // Sync userTypedValue with inputUrl when not focused
  useEffect(() => {
    if (!isUrlFocused) {
      setUserTypedValue(inputUrl)
      setSuggestion(null)
    }
  }, [inputUrl, isUrlFocused])

  return (
    <form
      onSubmit={onUrlSubmit}
      style={
        {
          flex: 1,
          alignSelf: 'stretch',
          WebkitAppRegion: 'no-drag',
          position: 'relative',
          display: 'flex',
          alignItems: 'center'
        } as React.CSSProperties
      }
    >
      <input
        ref={urlInputRef}
        type="text"
        value={inputUrl}
        onChange={handleInputChange}
        onFocus={onUrlFocus}
        onBlur={onUrlBlur}
        onKeyDown={handleKeyDown}
        placeholder="Search or enter URL"
        style={{
          width: '100%',
          height: '100%',
          padding: '0 12px',
          borderRadius: 0,
          border: 'none',
          borderLeft: `1px solid ${theme.border}`,
          borderRight: `1px solid ${theme.border}`,
          background: theme.background,
          color: isUrlFocused ? theme.text : 'transparent',
          fontSize: 13,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          outline: 'none',
          caretColor: theme.text,
          boxSizing: 'border-box'
        }}
      />
      {/* Inline autocomplete suggestion overlay */}
      {isUrlFocused && suggestion && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            padding: '8px 12px',
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none',
            overflow: 'hidden',
            whiteSpace: 'nowrap'
          }}
        >
          <span style={{ color: 'transparent' }}>{userTypedValue}</span>
          <span style={{ color: theme.textSecondary, opacity: 0.6 }}>{suggestion}</span>
        </div>
      )}
      {!isUrlFocused && urlParts && (
        <div
          onClick={() => urlInputRef.current?.focus()}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            padding: '8px 12px',
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis'
          }}
        >
          <span style={{ color: theme.textSecondary, flexShrink: 0 }}>{urlParts.protocol}</span>
          <span style={{ color: theme.text, flexShrink: 0 }}>{urlParts.domain}</span>
          <span
            style={{ color: theme.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {urlParts.path}
          </span>
        </div>
      )}
      {!isUrlFocused && !urlParts && inputUrl && (
        <div
          onClick={() => urlInputRef.current?.focus()}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            padding: '8px 12px',
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none',
            color: theme.text,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis'
          }}
        >
          {inputUrl}
        </div>
      )}
    </form>
  )
}
