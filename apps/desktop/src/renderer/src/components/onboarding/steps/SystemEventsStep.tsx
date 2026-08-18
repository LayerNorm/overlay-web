import React, { useEffect, useState } from 'react'
import { OnboardingTheme } from '../types'
import {
  getContainerStyle,
  getButtonStyle,
  getEmojiStyle,
  applyButtonHover,
  resetButtonHover
} from '../styles'

interface SystemEventsStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
}

export function SystemEventsStep({
  theme,
  onNext,
  isTransitioning
}: SystemEventsStepProps): React.ReactElement<any> {
  const containerStyle = getContainerStyle(theme, isTransitioning)
  const buttonStyle = getButtonStyle(theme)
  const [permissionRequested, setPermissionRequested] = useState(false)

  // Only poll for permission after user has clicked the button
  useEffect(() => {
    if (!permissionRequested) return

    const checkSystemEventsPermission = async (): Promise<void> => {
      try {
        const result = await window.bridge?.checkSystemEventsPermission?.()
        if (result === true) {
          onNext()
        }
      } catch (e) {
        console.error('Failed to check system events permission:', e)
      }
    }

    const interval = setInterval(checkSystemEventsPermission, 500)
    return () => clearInterval(interval)
  }, [onNext, permissionRequested])

  const requestSystemEventsPermission = async (): Promise<void> => {
    try {
      setPermissionRequested(true)
      await window.bridge?.requestSystemEventsPermission?.()
    } catch (e) {
      console.error('Failed to request system events permission:', e)
    }
  }

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center', maxWidth: '420px' }}>
        <div style={getEmojiStyle()}>⚙️</div>
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
          needs system events permission to paste your transcription
        </h2>
        <button
          style={buttonStyle}
          onClick={requestSystemEventsPermission}
          onMouseEnter={(e) => applyButtonHover(e, theme)}
          onMouseLeave={(e) => resetButtonHover(e, theme)}
        >
          give system events permission
        </button>
      </div>
    </div>
  )
}
