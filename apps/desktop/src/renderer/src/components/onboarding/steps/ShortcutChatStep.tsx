import React, { useState, useEffect, useCallback } from 'react'
import { OnboardingTheme } from '../types'
import { HotkeyDialog } from '../../ui/HotkeyDialog'
import { Brain } from 'lucide-react'
import {
  getContainerStyle,
  getButtonStyle,
  getTitleStyle,
  getSubtitleStyle,
  getHotkeyBadgeStyle,
  applyButtonHover,
  resetButtonHover,
  getSecondaryButtonStyle,
  applySecondaryButtonHover,
  resetSecondaryButtonHover
} from '../styles'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'

interface ShortcutChatStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
  initialHotkey: string
  onHotkeyChange: (hotkey: string) => void
}

export function ShortcutChatStep({
  theme,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onNext,
  isTransitioning,
  initialHotkey,
  onHotkeyChange
}: ShortcutChatStepProps): React.ReactElement {
  const [chatHotkey, setChatHotkey] = useState(initialHotkey)
  const [showHotkeyDialog, setShowHotkeyDialog] = useState(false)
  const [showAddMemoryDialog, setShowAddMemoryDialog] = useState(false)
  const [memoryText, setMemoryText] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Ensure panel hotkeys are initialized when entering this step
  useEffect(() => {
    void window.bridge?.initializeOnboardingPanelHotkeys?.()
  }, [])

  const handleSaveMemory = useCallback(async () => {
    if (!memoryText.trim() || isSaving) return
    setIsSaving(true)
    try {
      await window.bridge?.memory?.add?.({
        content: memoryText.trim(),
        type: 'fact',
        importance: 0.5,
        source: { chatId: 'onboarding-import' }
      })
      setMemoryText('')
      setShowAddMemoryDialog(false)
    } catch (err) {
      console.error('Failed to add memory:', err)
    } finally {
      setIsSaving(false)
    }
  }, [memoryText, isSaving])

  const containerStyle = getContainerStyle(theme, isTransitioning)
  const buttonStyle = getButtonStyle(theme)
  const secondaryButtonStyle = getSecondaryButtonStyle(theme)
  const hotkeyBadgeStyle = getHotkeyBadgeStyle(theme)

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center', maxWidth: '550px' }}>
        <img
          src={logoImage}
          alt="Overlay"
          style={{
            width: '32px',
            height: '32px',
            marginBottom: '16px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.1s',
            opacity: 0
          }}
        />
        <h2 style={{ ...getTitleStyle(theme, '0.2s'), marginBottom: '30px' }}>chat</h2>
        <p style={{ ...getSubtitleStyle(theme, '0.3s'), lineHeight: '2.2' }}>
          <span
            onClick={() => setShowHotkeyDialog(true)}
            style={hotkeyBadgeStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.buttonHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme.surface
            }}
          >
            {chatHotkey}
          </span>
          <br />
          press to toggle chat
          <br />
          <span style={{ fontSize: '13px', opacity: 0.85 }}>
            hold to speak directly into chat
          </span>
        </p>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            animation: 'fadeSlideIn 0.8s ease forwards',
            animationDelay: '0.6s',
            opacity: 0,
            // @ts-expect-error - webkit property for electron drag region
            WebkitAppRegion: 'no-drag'
          }}
        >
          <button
            style={{
              ...secondaryButtonStyle,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: `1px solid ${theme.border}`
            }}
            onClick={() => setShowAddMemoryDialog(true)}
            onMouseEnter={(e) => applySecondaryButtonHover(e, theme)}
            onMouseLeave={(e) => resetSecondaryButtonHover(e)}
          >
            <Brain size={14} />
            add memories
          </button>
        </div>
      </div>
      <HotkeyDialog
        isOpen={showHotkeyDialog}
        onClose={() => setShowHotkeyDialog(false)}
        onSave={(hotkey) => {
          setChatHotkey(hotkey)
          onHotkeyChange(hotkey)
        }}
        currentHotkey={chatHotkey}
        title="Press the hotkey you want to use for the chat panel:"
        theme={theme}
      />

      {/* Add Memory Dialog */}
      {showAddMemoryDialog && (
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
            // @ts-expect-error - webkit property for electron drag region
            WebkitAppRegion: 'no-drag'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSaving) setShowAddMemoryDialog(false)
          }}
        >
          <div
            style={{
              background: theme.modalBackground,
              borderRadius: '16px',
              padding: '24px',
              width: '450px',
              maxWidth: '90vw',
              border: `1px solid ${theme.modalBorder}`,
              boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
              // @ts-expect-error - webkit property for electron drag region
              WebkitAppRegion: 'no-drag'
            }}
          >
            <h3
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: theme.text,
                margin: 0,
                marginBottom: '16px'
              }}
            >
              Import Memories
            </h3>
            <div style={{ fontSize: '13px', color: theme.textSecondary, marginBottom: '16px', textAlign: 'left' }}>
              <p style={{ margin: '0 0 12px 0' }}>Import your memories from other AI assistants:</p>
              <div style={{ marginBottom: '8px' }}>
                <strong>ChatGPT:</strong> Go to your profile → Personalization → Memories → Manage memories → Select all (Cmd + A) → Copy → Paste below
              </div>
              <div style={{ marginBottom: '8px' }}>
                <strong>Claude / Gemini:</strong> Ask: &quot;Write out your memories of me verbatim, exactly as they appear in your memory&quot; → Copy the response → Paste below
              </div>
            </div>
            <textarea
              value={memoryText}
              onChange={(e) => setMemoryText(e.target.value)}
              placeholder="Paste or type your text here..."
              style={{
                width: '100%',
                minHeight: '120px',
                padding: '12px',
                borderRadius: '8px',
                border: `1px solid ${theme.border}`,
                background: theme.surface,
                color: theme.text,
                fontSize: '14px',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                // @ts-expect-error - webkit property for electron drag region
                WebkitAppRegion: 'no-drag'
              }}
            />
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowAddMemoryDialog(false)}
                disabled={isSaving}
                style={{
                  ...secondaryButtonStyle,
                  opacity: isSaving ? 0.5 : 1,
                  // @ts-expect-error - webkit property for electron drag region
                  WebkitAppRegion: 'no-drag'
                }}
                onMouseEnter={(e) => !isSaving && applySecondaryButtonHover(e, theme)}
                onMouseLeave={(e) => resetSecondaryButtonHover(e)}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMemory}
                disabled={!memoryText.trim() || isSaving}
                style={{
                  ...buttonStyle,
                  opacity: memoryText.trim() && !isSaving ? 1 : 0.5,
                  cursor: memoryText.trim() && !isSaving ? 'pointer' : 'not-allowed',
                  // @ts-expect-error - webkit property for electron drag region
                  WebkitAppRegion: 'no-drag'
                }}
                onMouseEnter={(e) => memoryText.trim() && !isSaving && applyButtonHover(e, theme)}
                onMouseLeave={(e) => resetButtonHover(e, theme)}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
