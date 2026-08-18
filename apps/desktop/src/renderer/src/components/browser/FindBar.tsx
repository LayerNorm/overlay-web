import { useState, useEffect, useRef, useCallback, ReactElement } from 'react'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'

interface FindBarProps {
  isOpen: boolean
  onClose: () => void
  tabId: string | null
  theme: {
    background: string
    surface: string
    text: string
    textSecondary: string
    border: string
    accent: string
  }
}

interface FindResult {
  activeMatchOrdinal: number
  matches: number
}

export function FindBar({ isOpen, onClose, tabId, theme }: FindBarProps): ReactElement<any> | null {
  const [searchText, setSearchText] = useState('')
  const [findResult, setFindResult] = useState<FindResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setSearchText('')
      setFindResult(null)
      if (tabId) {
        window.bridge.browser.stopFindInPage(tabId, 'clearSelection')
      }
    }
  }, [isOpen, tabId])

  useEffect(() => {
    if (!tabId) return

    const unsub = window.bridge.browser.onFoundInPage((result: FindResult) => {
      setFindResult(result)
    })

    return () => {
      unsub()
    }
  }, [tabId])

  const performFind = useCallback(
    (text: string, forward: boolean = true, findNext: boolean = false): void => {
      if (!tabId || !text.trim()) return
      window.bridge.browser.findInPage(tabId, text, { forward, findNext })
    },
    [tabId]
  )

  const handleClose = useCallback((): void => {
    if (tabId) {
      window.bridge.browser.stopFindInPage(tabId, 'clearSelection')
    }
    onClose()
  }, [tabId, onClose])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
      }

      if (!isOpen) return

      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          performFind(searchText, false, true)
        } else {
          performFind(searchText, true, true)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, searchText, performFind, handleClose])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const text = e.target.value
    setSearchText(text)

    // Clear any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (text.trim() && tabId) {
      // Debounce the search to avoid too many rapid calls
      debounceRef.current = setTimeout(() => {
        window.bridge.browser.findInPage(tabId, text, { forward: true, findNext: false })
      }, 50)
    } else if (!text.trim() && tabId) {
      window.bridge.browser.stopFindInPage(tabId, 'clearSelection')
      setFindResult(null)
    }
  }

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  const findNext = (): void => {
    performFind(searchText, true, true)
  }

  const findPrevious = (): void => {
    performFind(searchText, false, true)
  }

  if (!isOpen) return null

  const hasResults = findResult && findResult.matches > 0
  const noResults = searchText.trim() && findResult && findResult.matches === 0

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: theme.surface,
        borderBottom: `1px solid ${theme.border}`,
        animation: 'slideDown 0.15s ease-out'
      }}
    >
      <Search size={14} color={theme.textSecondary} />

      <input
        ref={inputRef}
        type="text"
        value={searchText}
        onChange={handleSearchChange}
        placeholder="Find in page..."
        style={{
          flex: 1,
          padding: '4px 8px',
          borderRadius: 4,
          border: `1px solid ${noResults ? '#ef4444' : theme.border}`,
          background: theme.background,
          color: theme.text,
          fontSize: 12,
          outline: 'none',
          minWidth: 150
        }}
      />

      {searchText.trim() && (
        <span
          style={{
            fontSize: 11,
            color: noResults ? '#ef4444' : theme.textSecondary,
            minWidth: 45,
            textAlign: 'center'
          }}
        >
          {noResults
            ? 'No matches'
            : hasResults
              ? `${findResult.activeMatchOrdinal}/${findResult.matches}`
              : '...'}
        </span>
      )}

      <div style={{ display: 'flex', gap: 2 }}>
        <button
          onClick={findPrevious}
          disabled={!hasResults}
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            cursor: hasResults ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hasResults ? 1 : 0.4
          }}
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp size={14} color={theme.text} />
        </button>
        <button
          onClick={findNext}
          disabled={!hasResults}
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            cursor: hasResults ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hasResults ? 1 : 0.4
          }}
          title="Next match (Enter)"
        >
          <ChevronDown size={14} color={theme.text} />
        </button>
      </div>

      <button
        onClick={handleClose}
        style={{
          width: 24,
          height: 24,
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title="Close (Escape)"
      >
        <X size={14} color={theme.textSecondary} />
      </button>

      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
