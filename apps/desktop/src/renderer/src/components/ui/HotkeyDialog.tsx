import React, { useState, useEffect, useCallback } from 'react'
import { Theme, lightTheme } from '../../utils/theme'

const DIALOG_ANIMATION_DURATION = 150

interface HotkeyDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (hotkey: string) => void
  currentHotkey?: string
  title?: string
  theme?: Theme
  onSameAsTranscription?: () => void
}

// Key code mappings for special keys
const KEY_SYMBOLS: Record<string, string> = {
  Meta: 'Cmd ⌘',
  Control: 'Ctrl ⌃',
  Alt: 'Option ⌥',
  Shift: 'Shift ⇧',
  ' ': 'Space ␣',
  Enter: 'Return ↵',
  Escape: 'Esc ⎋',
  Tab: 'Tab ⇥',
  Backspace: 'Delete ⌫',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→'
}

const MODIFIER_KEYS = ['Meta', 'Control', 'Alt', 'Shift']
const SPECIAL_KEYS = [
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ' '
]
const CODE_KEY_MAP: Record<string, string> = {
  Space: ' ',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Minus: '-',
  Equal: '='
}

function formatKey(key: string): string {
  return KEY_SYMBOLS[key] || key.toUpperCase()
}

function normalizeKey(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.includes(event.key)) {
    return null
  }

  const { code } = event

  if (code.startsWith('Key')) {
    return code.slice(3).toUpperCase()
  }

  if (code.startsWith('Digit')) {
    return code.slice(5)
  }

  if (CODE_KEY_MAP[code]) {
    return CODE_KEY_MAP[code]
  }

  if (SPECIAL_KEYS.includes(event.key)) {
    return event.key
  }

  if (event.key.length === 1) {
    return event.key.toUpperCase()
  }

  return event.key
}

function sortKeys(keys: string[]): string[] {
  const modifiers: string[] = []
  const specials: string[] = []
  const alphanumeric: string[] = []

  keys.forEach((key) => {
    if (MODIFIER_KEYS.includes(key)) {
      modifiers.push(key)
    } else if (SPECIAL_KEYS.includes(key)) {
      specials.push(key)
    } else {
      alphanumeric.push(key)
    }
  })

  // Sort modifiers in specific order: Meta, Control, Alt, Shift
  const modifierOrder = ['Meta', 'Control', 'Alt', 'Shift']
  modifiers.sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b))

  return [...modifiers, ...specials, ...alphanumeric]
}

export function HotkeyDialog({
  isOpen,
  onClose,
  onSave,
  currentHotkey,
  title = 'Press the hotkey you want to use to start recording:',
  theme = lightTheme,
  onSameAsTranscription
}: HotkeyDialogProps): React.ReactElement<any> | null {
  const [recordedKeys, setRecordedKeys] = useState<Set<string>>(new Set())
  const [displayKeys, setDisplayKeys] = useState<string[]>([])
  const [allKeysReleased, setAllKeysReleased] = useState(true)

  useEffect(() => {
    if (!isOpen) {
      setRecordedKeys(new Set())
      setDisplayKeys([])
      setAllKeysReleased(true)
      return
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      // If all keys were released and user presses a new key, reset the recording
      let keys: Set<string>
      if (allKeysReleased) {
        keys = new Set()
        setAllKeysReleased(false)
      } else {
        keys = new Set(recordedKeys)
      }

      if (e.key === 'Meta' || e.metaKey) keys.add('Meta')
      if (e.key === 'Control' || e.ctrlKey) keys.add('Control')
      if (e.key === 'Alt' || e.altKey) keys.add('Alt')
      if (e.key === 'Shift' || e.shiftKey) keys.add('Shift')

      if (!MODIFIER_KEYS.includes(e.key)) {
        const normalizedKey = normalizeKey(e)
        if (normalizedKey) {
          keys.add(normalizedKey)
        }
      }

      setRecordedKeys(keys)
      const sortedKeys = sortKeys(Array.from(keys))
      setDisplayKeys(sortedKeys)
    }

    const handleKeyUp = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      // Check if all keys are now released
      // We need to check in the next tick to allow all keyup events to process
      setTimeout(() => {
        const anyKeyPressed = e.metaKey || e.ctrlKey || e.altKey || e.shiftKey
        if (!anyKeyPressed) {
          setAllKeysReleased(true)
        }
      }, 10)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [isOpen, recordedKeys, allKeysReleased])

  const handleSave = (): void => {
    if (displayKeys.length > 0) {
      const formattedHotkey = displayKeys.map(formatKey).join(' + ')
      onSave(formattedHotkey)
    }
    onClose()
  }

  const [isAnimating, setIsAnimating] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined
    if (isOpen) {
      setShouldRender(true)
      requestAnimationFrame(() => setIsAnimating(true))
    } else {
      setIsAnimating(false)
      timer = setTimeout(() => setShouldRender(false), DIALOG_ANIMATION_DURATION)
    }
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [isOpen])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  if (!shouldRender) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: theme.scrim,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        opacity: isAnimating ? 1 : 0,
        transition: `opacity ${DIALOG_ANIMATION_DURATION}ms ease-out`,
        overflow: 'hidden'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel()
      }}
    >
      <div
        style={{
          background: theme.modalBackground,
          borderRadius: '16px',
          padding: '32px',
          minWidth: '420px',
          maxWidth: '480px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '20px',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
          border: `1px solid ${theme.modalBorder}`,
          transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(8px)',
          transition: `transform ${DIALOG_ANIMATION_DURATION}ms ease-out`
        }}
      >
        <h2
          style={{
            color: theme.text,
            fontSize: '18px',
            fontWeight: '600',
            margin: 0,
            textAlign: 'left',
            lineHeight: '1.4',
            width: '100%',
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }}
        >
          {title}
        </h2>

        <div
          style={{
            background: 'transparent',
            borderRadius: '12px',
            padding: '24px',
            minHeight: '80px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            width: '100%',
            boxSizing: 'border-box',
            border: `1px dashed ${theme.border}`,
            transition: 'border-color 0.15s ease',
            overflow: 'hidden'
          }}
        >
          {displayKeys.length > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'nowrap',
                justifyContent: 'flex-start',
                overflowX: 'auto',
                maxWidth: '100%',
                padding: '4px 0'
              }}
            >
              {displayKeys.map((key, index) => (
                <span key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      color: theme.text,
                      fontSize: '18px',
                      fontWeight: '600',
                      fontFamily:
                        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      padding: '6px 14px',
                      background: theme.surface,
                      borderRadius: '8px',
                      border: `1px solid ${theme.border}`,
                      textAlign: 'center',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {formatKey(key)}
                  </span>
                  {index < displayKeys.length - 1 && (
                    <span style={{ color: theme.textSecondary, fontSize: '16px', opacity: 0.4 }}>
                      +
                    </span>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <span
              style={{
                color: theme.textSecondary,
                fontSize: '14px',
                fontWeight: '500',
                fontFamily:
                  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
              }}
            >
              {currentHotkey ? `Current: ${currentHotkey}` : 'Press a key combination...'}
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            width: '100%',
            fontFamily: 'inherit'
          }}
        >
          <button
            onClick={handleCancel}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease'
            }}
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
            onClick={handleSave}
            disabled={displayKeys.length === 0}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: displayKeys.length > 0 ? theme.toggleThumb : theme.textDisabled,
              background: displayKeys.length > 0 ? theme.buttonBg : 'transparent',
              border: 'none',
              cursor: displayKeys.length > 0 ? 'pointer' : 'not-allowed',
              opacity: displayKeys.length > 0 ? 1 : 0.5,
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (displayKeys.length > 0) e.currentTarget.style.background = theme.buttonHover
            }}
            onMouseLeave={(e) => {
              if (displayKeys.length > 0) e.currentTarget.style.background = theme.buttonBg
            }}
          >
            Save
          </button>
        </div>

        {onSameAsTranscription && (
          <button
            onClick={() => {
              onSameAsTranscription()
              onClose()
            }}
            style={{
              width: '100%',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 450,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.textSecondary,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease, color 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
              e.currentTarget.style.color = theme.text
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = theme.textSecondary
            }}
          >
            Use same as Transcription Shortcut
          </button>
        )}
      </div>
    </div>
  )
}
