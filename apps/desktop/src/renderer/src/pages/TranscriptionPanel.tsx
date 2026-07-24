import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  Notebook,
  MessageCircle,
  ChevronDown,
  Plus,
  History,
  BookPlus
} from 'lucide-react'
import { usePanelTheme } from '../hooks/usePanelTheme'
import { TrafficLightButtons } from '../components/ui/TrafficLightButtons'

export function TranscriptionPanel(): React.ReactElement {
  const [isVisible, setIsVisible] = useState(false)
  const [isProtected, setIsProtected] = useState(false)
  const [transcriptionText, setTranscriptionText] = useState('')
  const [copied, setCopied] = useState(false)
  const [showNoteDropdown, setShowNoteDropdown] = useState(false)
  const [showChatDropdown, setShowChatDropdown] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [addedToDictionary, setAddedToDictionary] = useState(false)
  const [isOptionHeld, setIsOptionHeld] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const noteDropdownRef = useRef<HTMLDivElement>(null)
  const chatDropdownRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const { theme } = usePanelTheme()

  // Animate in on mount - immediate for faster perceived load
  useEffect(() => {
    setIsVisible(true)
  }, [])

  // Track Option key for Option+drag to move window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.altKey && !isOptionHeld) {
        setIsOptionHeld(true)
      }
    }
    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt' || !e.altKey) {
        setIsOptionHeld(false)
        setIsDragging(false)
        dragStartRef.current = null
      }
    }
    const handleBlur = (): void => {
      setIsOptionHeld(false)
      setIsDragging(false)
      dragStartRef.current = null
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [isOptionHeld])

  // Handle Option+drag mouse events for moving window
  const handleDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isOptionHeld) {
        e.preventDefault()
        setIsDragging(true)
        dragStartRef.current = { x: e.screenX, y: e.screenY }
      }
    },
    [isOptionHeld]
  )

  const handleDragMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging && dragStartRef.current && isOptionHeld) {
        const deltaX = e.screenX - dragStartRef.current.x
        const deltaY = e.screenY - dragStartRef.current.y
        dragStartRef.current = { x: e.screenX, y: e.screenY }
        window.bridge.moveWindowBy(deltaX, deltaY)
      }
    },
    [isDragging, isOptionHeld]
  )

  const handleDragMouseUp = useCallback(() => {
    setIsDragging(false)
    dragStartRef.current = null
  }, [])

  // Listen for transcription text from main process
  useEffect(() => {
    const handleTranscriptionText = (text: string) => {
      setTranscriptionText(text)
      // Focus the textarea after receiving text
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      }, 100)
    }

    const unsubscribe = window.bridge?.onTranscriptionText?.(handleTranscriptionText)
    return () => {
      unsubscribe?.()
    }
  }, [])

  const toggleContentProtection = useCallback(async () => {
    const newValue = !isProtected
    await window.bridge.setContentProtection('transcription', newValue)
    setIsProtected(newValue)
  }, [isProtected])

  const copyToClipboard = useCallback(() => {
    if (transcriptionText) {
      navigator.clipboard.writeText(transcriptionText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [transcriptionText])

  const addToNewChat = useCallback(async () => {
    if (!transcriptionText) return
    await window.bridge.sendTextToNewChat(transcriptionText)
    setShowChatDropdown(false)
  }, [transcriptionText])

  const addToLastChat = useCallback(async () => {
    if (!transcriptionText) return
    await window.bridge.sendTextToChatInput(transcriptionText)
    setShowChatDropdown(false)
  }, [transcriptionText])

  const addToNewNote = useCallback(async () => {
    if (!transcriptionText) return
    await window.bridge.sendTextToNewNote(transcriptionText)
    setShowNoteDropdown(false)
  }, [transcriptionText])

  const addToLastNote = useCallback(async () => {
    if (!transcriptionText) return
    await window.bridge.sendTextToNoteInput(transcriptionText)
    setShowNoteDropdown(false)
  }, [transcriptionText])

  const addToDictionary = useCallback(() => {
    if (!transcriptionText) return

    // Get selected text from textarea or use full text
    const textarea = textareaRef.current
    let textToAdd = transcriptionText.trim()

    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      textToAdd = transcriptionText.substring(textarea.selectionStart, textarea.selectionEnd).trim()
    }

    if (!textToAdd) return

    // Get current dictionary words from localStorage
    const settingsKey = 'overlay-settings'
    const saved = localStorage.getItem(settingsKey)
    const settings = saved ? JSON.parse(saved) : {}
    const currentWords: string[] = settings.dictionaryWords || []

    // Split by spaces/punctuation to get individual words, or add as phrase if short
    const wordsToAdd = textToAdd.split(/\s+/).filter((w) => w.length > 0)

    // Add new words that aren't already in the dictionary
    const newWords = wordsToAdd.filter((word) => !currentWords.includes(word))

    if (newWords.length > 0) {
      settings.dictionaryWords = [...currentWords, ...newWords]
      localStorage.setItem(settingsKey, JSON.stringify(settings))

      setAddedToDictionary(true)
      setTimeout(() => setAddedToDictionary(false), 2000)
    }
  }, [transcriptionText])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (noteDropdownRef.current && !noteDropdownRef.current.contains(e.target as Node)) {
        setShowNoteDropdown(false)
      }
      if (chatDropdownRef.current && !chatDropdownRef.current.contains(e.target as Node)) {
        setShowChatDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div
      style={
        {
          width: '100%',
          height: '100%',
          background: theme.panelBgOpacity(95),
          borderRadius: 16,
          border: `1px solid ${theme.border}`,
          backdropFilter: 'blur(20px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          WebkitAppRegion: 'drag',
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(10px)',
          transition: 'opacity 0.1s ease-out, transform 0.1s ease-out'
        } as React.CSSProperties
      }
    >
      {/* Option+drag overlay for moving window */}
      <div
        onMouseDown={handleDragMouseDown}
        onMouseMove={handleDragMouseMove}
        onMouseUp={handleDragMouseUp}
        onMouseLeave={handleDragMouseUp}
        style={
          {
            position: 'absolute',
            inset: 0,
            zIndex: isOptionHeld ? 1000 : -1,
            cursor: isOptionHeld ? (isDragging ? 'grabbing' : 'grab') : 'default',
            background: isOptionHeld ? 'rgba(0, 0, 0, 0.02)' : 'transparent',
            pointerEvents: isOptionHeld ? 'auto' : 'none',
            opacity: isOptionHeld ? 1 : 0,
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties
        }
      />

      {/* Header */}
      <div
        style={
          {
            padding: '12px 16px',
            borderBottom: `1px solid ${theme.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            WebkitAppRegion: 'drag'
          } as React.CSSProperties
        }
      >
        {/* Traffic Light Buttons - wrapped in no-drag container */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <TrafficLightButtons
            panelType="transcription"
            onClose={() => window.bridge.destroyPanel()}
            onMinimize={() => window.bridge.hidePanel('transcription')}
            onMaximize={async () => {
              const result = await window.bridge.maximizePanel()
              if (result.success) setIsMaximized(result.isMaximized)
            }}
            isMaximized={isMaximized}
          />
        </div>

        {/* Title */}
        <span
          style={{
            flex: 1,
            color: theme.textSecondary,
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500
          }}
        >
          Transcription
        </span>

        {/* Content Protection Toggle (Eye Button) - wrapped in no-drag container */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={toggleContentProtection}
            title={isProtected ? 'Show in screenshots' : 'Hide from screenshots'}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: theme.buttonBg,
              border: `1px solid ${theme.buttonBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              flexShrink: 0
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.buttonBgHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme.buttonBg
            }}
          >
            {isProtected ? (
              <EyeOff size={16} color={theme.iconColor} />
            ) : (
              <Eye size={16} color={theme.iconColor} />
            )}
          </button>
        </div>
      </div>

      {/* Editable transcription area */}
      <div
        style={
          {
            flex: 1,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties
        }
      >
        <textarea
          ref={textareaRef}
          value={transcriptionText}
          onChange={(e) => setTranscriptionText(e.target.value)}
          placeholder="Transcription will appear here..."
          style={{
            flex: 1,
            width: '100%',
            padding: 12,
            background: theme.inputBg,
            border: `1px solid ${theme.inputBorder}`,
            borderRadius: 12,
            color: theme.text,
            fontSize: 14,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            lineHeight: 1.6,
            resize: 'none',
            outline: 'none',
            transition: 'border-color 0.15s ease'
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = theme.inputBorderFocus
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = theme.inputBorder
          }}
        />
      </div>

      {/* Footer with action buttons */}
      <div
        style={
          {
            padding: '12px 16px',
            borderTop: `1px solid ${theme.border}`,
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties
        }
      >
        {/* Add to Note dropdown */}
        <div ref={noteDropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => transcriptionText && setShowNoteDropdown(!showNoteDropdown)}
            disabled={!transcriptionText}
            title="Add to Note"
            style={{
              padding: '10px 16px',
              background: transcriptionText ? theme.buttonBgHover : theme.buttonBg,
              border: `1px solid ${theme.buttonBorder}`,
              borderRadius: 10,
              color: transcriptionText ? theme.text : theme.textMuted,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontWeight: 500,
              cursor: transcriptionText ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (transcriptionText) {
                e.currentTarget.style.background = theme.buttonBgActive
              }
            }}
            onMouseLeave={(e) => {
              if (!showNoteDropdown) {
                e.currentTarget.style.background = transcriptionText
                  ? theme.buttonBgHover
                  : theme.buttonBg
              }
            }}
          >
            <Notebook size={16} />
            Add to Note
            <ChevronDown size={14} style={{ marginLeft: -4 }} />
          </button>
          {showNoteDropdown && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 4px)',
                left: 0,
                background: theme.dropdownBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                padding: 4,
                minWidth: 180,
                boxShadow: theme.isDark
                  ? '0 8px 32px rgba(0,0,0,0.4)'
                  : '0 8px 32px rgba(0,0,0,0.15)',
                zIndex: 100
              }}
            >
              <button
                onClick={addToNewNote}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: theme.text,
                  fontSize: 13,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.dropdownItemHover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Plus size={14} />
                Add to New Note
              </button>
              <button
                onClick={addToLastNote}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: theme.text,
                  fontSize: 13,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.dropdownItemHover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <History size={14} />
                Add to Last Opened Note
              </button>
            </div>
          )}
        </div>

        {/* Copy to Clipboard button */}
        <button
          onClick={copyToClipboard}
          disabled={!transcriptionText}
          title="Copy to Clipboard"
          style={{
            padding: '10px 16px',
            background: transcriptionText ? theme.buttonBgHover : theme.buttonBg,
            border: `1px solid ${theme.buttonBorder}`,
            borderRadius: 10,
            color: transcriptionText ? theme.text : theme.textMuted,
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500,
            cursor: transcriptionText ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            if (transcriptionText) {
              e.currentTarget.style.background = theme.buttonBgActive
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = transcriptionText
              ? theme.buttonBgHover
              : theme.buttonBg
          }}
        >
          {copied ? (
            <>
              <Check size={16} color="rgba(34, 197, 94, 0.9)" />
              Copied!
            </>
          ) : (
            <>
              <Copy size={16} />
              Copy
            </>
          )}
        </button>

        {/* Add to Dictionary button */}
        <button
          onClick={addToDictionary}
          disabled={!transcriptionText}
          title="Add selected text or all words to dictionary"
          style={{
            padding: '10px 16px',
            background: transcriptionText ? theme.buttonBgHover : theme.buttonBg,
            border: `1px solid ${theme.buttonBorder}`,
            borderRadius: 10,
            color: transcriptionText ? theme.text : theme.textMuted,
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500,
            cursor: transcriptionText ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            if (transcriptionText) {
              e.currentTarget.style.background = theme.buttonBgActive
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = transcriptionText
              ? theme.buttonBgHover
              : theme.buttonBg
          }}
        >
          {addedToDictionary ? (
            <>
              <Check size={16} color="rgba(34, 197, 94, 0.9)" />
              Added!
            </>
          ) : (
            <>
              <BookPlus size={16} />
              Dictionary
            </>
          )}
        </button>

        {/* Add to Chat dropdown */}
        <div ref={chatDropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => transcriptionText && setShowChatDropdown(!showChatDropdown)}
            disabled={!transcriptionText}
            title="Add to Chat"
            style={{
              padding: '10px 16px',
              background: transcriptionText ? theme.buttonBgHover : theme.buttonBg,
              border: `1px solid ${theme.buttonBorder}`,
              borderRadius: 10,
              color: transcriptionText ? theme.text : theme.textMuted,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontWeight: 500,
              cursor: transcriptionText ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (transcriptionText) {
                e.currentTarget.style.background = theme.buttonBgActive
              }
            }}
            onMouseLeave={(e) => {
              if (!showChatDropdown) {
                e.currentTarget.style.background = transcriptionText
                  ? theme.buttonBgHover
                  : theme.buttonBg
              }
            }}
          >
            <MessageCircle size={16} />
            Add to Chat
            <ChevronDown size={14} style={{ marginLeft: -4 }} />
          </button>
          {showChatDropdown && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 4px)',
                right: 0,
                background: theme.dropdownBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                padding: 4,
                minWidth: 180,
                boxShadow: theme.isDark
                  ? '0 8px 32px rgba(0,0,0,0.4)'
                  : '0 8px 32px rgba(0,0,0,0.15)',
                zIndex: 100
              }}
            >
              <button
                onClick={addToNewChat}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: theme.text,
                  fontSize: 13,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.dropdownItemHover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Plus size={14} />
                Add to New Chat
              </button>
              <button
                onClick={addToLastChat}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: theme.text,
                  fontSize: 13,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.dropdownItemHover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <History size={14} />
                Add to Last Opened Chat
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
