import React, { useState, useEffect, useCallback } from 'react'
import { Theme, lightTheme } from '../../utils/theme'
import { PhrasePair } from '../../hooks/useSettings'

const DIALOG_ANIMATION_DURATION = 150

interface PhraseReplacementDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (phrases: PhrasePair[]) => void
  currentPhrases: PhrasePair[]
  theme?: Theme
}

export function PhraseReplacementDialog({
  isOpen,
  onClose,
  onSave,
  currentPhrases,
  theme = lightTheme
}: PhraseReplacementDialogProps): React.ReactElement<any> | null {
  const [phrases, setPhrases] = useState<PhrasePair[]>(currentPhrases)
  const [originalPhrase, setOriginalPhrase] = useState('')
  const [replacementPhrase, setReplacementPhrase] = useState('')

  useEffect(() => {
    if (isOpen) {
      setPhrases(currentPhrases)
      setOriginalPhrase('')
      setReplacementPhrase('')
    }
  }, [isOpen, currentPhrases])

  const handleAddPhrase = (): void => {
    if (originalPhrase.trim() && replacementPhrase.trim()) {
      const newPhrase: PhrasePair = {
        id: Date.now().toString(),
        original: originalPhrase.trim(),
        replacement: replacementPhrase.trim()
      }
      setPhrases([...phrases, newPhrase])
      setOriginalPhrase('')
      setReplacementPhrase('')
    }
  }

  const handleRemovePhrase = (id: string): void => {
    setPhrases(phrases.filter((phrase) => phrase.id !== id))
  }

  const handleSave = (): void => {
    onSave(phrases)
    onClose()
  }

  const handleCancel = (): void => {
    onClose()
  }

  const handleKeyPress = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleAddPhrase()
    }
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

  const handleClose = useCallback(() => {
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
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        style={{
          background: theme.modalBackground,
          borderRadius: '16px',
          padding: '32px',
          width: '640px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
          border: `1px solid ${theme.modalBorder}`,
          overflow: 'hidden',
          transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(8px)',
          transition: `transform ${DIALOG_ANIMATION_DURATION}ms ease-out`
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px'
          }}
        >
          <h2
            style={{
              color: theme.text,
              fontSize: '20px',
              fontWeight: '600',
              margin: 0,
              fontFamily:
                'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}
          >
            Phrase Replacements
          </h2>
          <div
            style={{
              color: theme.textSecondary,
              fontSize: '14px',
              fontWeight: '500',
              background: theme.modalSurface,
              padding: '6px 12px',
              borderRadius: '20px',
              border: `1px solid ${theme.modalBorder}`
            }}
          >
            {phrases.length} {phrases.length === 1 ? 'rule' : 'rules'}
          </div>
        </div>

        <div
          style={{
            background: theme.modalSurface,
            borderRadius: '16px',
            padding: '20px',
            border: `1px solid ${theme.modalBorder}`
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-end'
            }}
          >
            <div style={{ flex: 1 }}>
              <label
                style={{
                  color: theme.textSecondary,
                  fontSize: '11px',
                  fontWeight: '700',
                  marginBottom: '8px',
                  display: 'block',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}
              >
                Replace
              </label>
              <input
                type="text"
                value={originalPhrase}
                onChange={(e) => setOriginalPhrase(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Enter phrase..."
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '12px',
                  color: theme.text,
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.15s ease',
                  fontFamily:
                    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = theme.text
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = theme.border
                }}
              />
            </div>

            <div style={{ flex: 1 }}>
              <label
                style={{
                  color: theme.textSecondary,
                  fontSize: '11px',
                  fontWeight: '700',
                  marginBottom: '8px',
                  display: 'block',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}
              >
                With
              </label>
              <input
                type="text"
                value={replacementPhrase}
                onChange={(e) => setReplacementPhrase(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Enter replacement..."
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '12px',
                  color: theme.text,
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.15s ease',
                  fontFamily:
                    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = theme.accent
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = theme.border
                }}
              />
            </div>

            <button
              onClick={handleAddPhrase}
              disabled={!originalPhrase.trim() || !replacementPhrase.trim()}
              style={{
                padding: '0 24px',
                background:
                  !originalPhrase.trim() || !replacementPhrase.trim()
                    ? 'transparent'
                    : theme.buttonBg,
                color:
                  !originalPhrase.trim() || !replacementPhrase.trim()
                    ? theme.textDisabled
                    : theme.toggleThumb,
                border: 'none',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: '600',
                cursor:
                  !originalPhrase.trim() || !replacementPhrase.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s ease',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '23px',
                opacity: !originalPhrase.trim() || !replacementPhrase.trim() ? 0.5 : 1
              }}
            >
              Add
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: '0',
            maxHeight: '350px',
            paddingRight: '4px'
          }}
        >
          {phrases.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: theme.textSecondary,
                fontSize: '14px',
                padding: '40px 20px',
                borderRadius: '12px',
                border: `1px dashed ${theme.border}`
              }}
            >
              No phrase replacements yet
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              {phrases.map((phrase) => (
                <div
                  key={phrase.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    background: 'transparent',
                    borderRadius: '12px',
                    border: `1px solid ${theme.border}`,
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.surface
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      color: theme.text,
                      fontSize: '14px',
                      fontFamily:
                        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {phrase.original}
                  </span>

                  <span
                    style={{
                      color: theme.textDisabled,
                      fontSize: '13px',
                      flexShrink: 0
                    }}
                  >
                    →
                  </span>

                  <span
                    style={{
                      flex: 1,
                      color: theme.text,
                      fontSize: '14px',
                      fontFamily:
                        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {phrase.replacement}
                  </span>

                  <button
                    onClick={() => handleRemovePhrase(phrase.id)}
                    style={{
                      width: '28px',
                      height: '28px',
                      background: 'transparent',
                      color: theme.textSecondary,
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '16px',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = theme.border
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginTop: 'auto',
            paddingTop: '20px',
            borderTop: `1px solid ${theme.modalBorder}`
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
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.toggleThumb,
              background: theme.buttonBg,
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.buttonHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme.buttonBg
            }}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}
