import React, { useState, useEffect } from 'react'
import { OnboardingTheme } from '../types'
import { getContainerStyle, getTitleStyle, getSubtitleStyle } from '../styles'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'

interface TestTranscriptionStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
  pushToTalkHotkey: string
}

export function TestTranscriptionStep({
  theme,
  onNext,
  isTransitioning,
  pushToTalkHotkey
}: TestTranscriptionStepProps): React.ReactElement {
  const [transcriptionText, setTranscriptionText] = useState('')
  const [isRecording, setIsRecording] = useState(false)

  const containerStyle = getContainerStyle(theme, isTransitioning)

  // Initialize panel hotkeys when entering this step
  useEffect(() => {
    void window.bridge?.initializeOnboardingPanelHotkeys?.()
  }, [])

  // Auto-advance when transcription is received
  useEffect(() => {
    if (transcriptionText) {
      const timer = setTimeout(() => {
        onNext()
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [transcriptionText, onNext])

  // Listen for recording events
  useEffect(() => {
    const offStart = window.bridge?.onRecordStart?.(() => {
      setIsRecording(true)
    })
    const offStop = window.bridge?.onRecordStop?.(() => {
      setIsRecording(false)
    })
    const offCancel = window.bridge?.onRecordCancel?.(() => {
      setIsRecording(false)
    })

    // Listen for transcription results via clipboard (since push-to-talk pastes to clipboard)
    const handleTranscription = (): void => {
      // Small delay to let the paste happen
      setTimeout(() => {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text && text.trim()) {
              setTranscriptionText(text.trim())
            }
          })
          .catch(() => {
            // Clipboard read failed, ignore
          })
      }, 100)
    }

    document.addEventListener('paste', handleTranscription)

    return () => {
      offStart?.()
      offStop?.()
      offCancel?.()
      document.removeEventListener('paste', handleTranscription)
    }
  }, [])

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center', maxWidth: '450px' }}>
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
        <h2 style={{ ...getTitleStyle(theme, '0.2s'), marginBottom: '30px' }}>voice</h2>
        <p style={{ ...getSubtitleStyle(theme, '0.3s'), lineHeight: '2.2' }}>
          <span
            style={{
              background: theme.surface,
              padding: '4px 10px',
              borderRadius: '6px',
              border: `1px solid ${theme.border}`,
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: '14px'
            }}
          >
            {pushToTalkHotkey}
          </span>
          <br />
          hold and release to transcribe
        </p>

        <div
          style={{
            width: '100%',
            minHeight: '80px',
            padding: '16px',
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: '12px',
            marginBottom: '24px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.4s',
            opacity: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {isRecording ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#ef4444',
                  animation: 'pulse 1s ease-in-out infinite'
                }}
              />
              <span style={{ color: theme.textSecondary, fontSize: '14px' }}>
                Recording... release to transcribe
              </span>
            </div>
          ) : transcriptionText ? (
            <p
              style={{
                color: theme.text,
                fontSize: '16px',
                margin: 0,
                textAlign: 'center',
                lineHeight: 1.5
              }}
            >
              {transcriptionText}
            </p>
          ) : (
            <span style={{ color: theme.textSecondary, fontSize: '14px' }}>
              Your transcription will appear here...
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
