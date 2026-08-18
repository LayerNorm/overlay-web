import React from 'react'
import { OnboardingStepProps } from '../types'
import { getContainerStyle, getButtonStyle, applyButtonHover, resetButtonHover } from '../styles'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'

interface GetStartedStepProps extends OnboardingStepProps {
  onComplete: () => void
}

export function GetStartedStep({
  theme,
  isTransitioning,
  onComplete
}: GetStartedStepProps): React.ReactElement<any> {
  const containerStyle = getContainerStyle(theme, isTransitioning)
  const buttonStyle = getButtonStyle(theme)

  return (
    <div style={containerStyle}>
      <div
        style={{
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
        <img
          src={logoImage}
          alt="Overlay Logo"
          style={{
            width: '64px',
            height: '64px',
            marginBottom: '24px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.1s',
            opacity: 0
          }}
        />
        <h2
          style={{
            fontSize: '32px',
            fontWeight: 500,
            color: theme.text,
            margin: 0,
            marginBottom: '42px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.3s',
            opacity: 0,
            fontFamily: "'Libre Baskerville', Georgia, serif",
            letterSpacing: '-0.02em'
          }}
        >
          personal computing, reimagined
        </h2>
        <button
          style={{
            ...buttonStyle,
            padding: '14px 32px',
            fontSize: '15px'
          }}
          onClick={onComplete}
          onMouseEnter={(e) => applyButtonHover(e, theme)}
          onMouseLeave={(e) => resetButtonHover(e, theme)}
        >
          get started
        </button>
      </div>
    </div>
  )
}
