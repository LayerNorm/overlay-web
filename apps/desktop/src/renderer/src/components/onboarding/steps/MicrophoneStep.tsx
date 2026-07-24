import React, { useEffect, useState } from 'react'
import { OnboardingTheme } from '../types'
import {
  getContainerStyle,
  getButtonStyle,
  getEmojiStyle,
  applyButtonHover,
  resetButtonHover
} from '../styles'

interface MicrophoneStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
}

export function MicrophoneStep({
  theme,
  onNext,
  isTransitioning
}: MicrophoneStepProps): React.ReactElement {
  const [permissionDenied, setPermissionDenied] = useState(false)
  const containerStyle = getContainerStyle(theme, isTransitioning)
  const buttonStyle = getButtonStyle(theme)

  // Poll for microphone permission
  useEffect(() => {
    const checkMicPermission = async (): Promise<void> => {
      try {
        const result = await window.bridge?.checkMicrophonePermission?.()
        if (result === 'granted') {
          onNext()
        } else if (result === 'denied') {
          setPermissionDenied(true)
        }
      } catch (e) {
        console.error('Failed to check mic permission:', e)
      }
    }

    const interval = setInterval(checkMicPermission, 500)
    return () => clearInterval(interval)
  }, [onNext])

  const requestMicrophonePermission = async (): Promise<void> => {
    try {
      const result = await window.bridge?.requestMicrophonePermission?.()
      if (result === 'denied') {
        setPermissionDenied(true)
      }
    } catch (e) {
      console.error('Failed to request mic permission:', e)
    }
  }

  const openSystemPreferences = async (): Promise<void> => {
    try {
      await window.bridge?.openExternal?.(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
      )
    } catch (e) {
      console.error('Failed to open System Preferences:', e)
    }
  }

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <div style={getEmojiStyle()}>🎙️</div>
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 500,
            color: theme.text,
            margin: 0,
            marginBottom: permissionDenied ? '16px' : '40px',
            lineHeight: 1.4,
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.3s',
            opacity: 0
          }}
        >
          {permissionDenied ? (
            'microphone access was denied'
          ) : (
            <>
              <span style={{ fontFamily: "'Libre Baskerville', Georgia, serif", fontWeight: 400 }}>
                overlay
              </span>{' '}
              needs microphone access to transcribe your voice
            </>
          )}
        </h2>
        {permissionDenied && (
          <p
            style={{
              fontSize: '14px',
              color: theme.textSecondary,
              margin: 0,
              marginBottom: '24px',
              lineHeight: 1.5,
              animation: 'unblur 0.5s ease forwards'
            }}
          >
            Please enable microphone access in System Settings, then return here.
          </p>
        )}
        <button
          style={buttonStyle}
          onClick={permissionDenied ? openSystemPreferences : requestMicrophonePermission}
          onMouseEnter={(e) => applyButtonHover(e, theme)}
          onMouseLeave={(e) => resetButtonHover(e, theme)}
        >
          {permissionDenied ? 'open system settings' : 'allow microphone access'}
        </button>
      </div>
    </div>
  )
}
