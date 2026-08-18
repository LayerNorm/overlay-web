import React, { useEffect } from 'react'
import { OnboardingTheme } from '../types'
import {
  getContainerStyle,
  getButtonStyle,
  getEmojiStyle,
  applyButtonHover,
  resetButtonHover
} from '../styles'

interface AccessibilityStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
}

export function AccessibilityStep({
  theme,
  onNext,
  isTransitioning
}: AccessibilityStepProps): React.ReactElement<any> {
  const containerStyle = getContainerStyle(theme, isTransitioning)
  const buttonStyle = getButtonStyle(theme)

  // Poll for accessibility permission
  useEffect(() => {
    const checkAccessibilityPermission = async (): Promise<void> => {
      try {
        const result = await window.bridge?.checkAccessibilityPermission?.()
        if (result === true) {
          onNext()
        }
      } catch (e) {
        console.error('Failed to check accessibility permission:', e)
      }
    }

    const interval = setInterval(checkAccessibilityPermission, 500)
    return () => clearInterval(interval)
  }, [onNext])

  const requestAccessibilityPermission = async (): Promise<void> => {
    try {
      await window.bridge?.requestAccessibilityPermission?.()
    } catch (e) {
      console.error('Failed to request accessibility permission:', e)
    }
  }

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center', maxWidth: '420px' }}>
        <div style={getEmojiStyle()}>⌨️</div>
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 500,
            color: theme.text,
            margin: 0,
            marginBottom: '40px',
            lineHeight: 1.4,
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.3s',
            opacity: 0
          }}
        >
          <span style={{ fontFamily: "'Libre Baskerville', Georgia, serif", fontWeight: 400 }}>
            overlay
          </span>{' '}
          needs accessibility permission to paste your transcription
        </h2>
        <button
          style={buttonStyle}
          onClick={requestAccessibilityPermission}
          onMouseEnter={(e) => applyButtonHover(e, theme)}
          onMouseLeave={(e) => resetButtonHover(e, theme)}
        >
          give accessibility permission
        </button>
      </div>
    </div>
  )
}
