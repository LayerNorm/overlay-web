import React from 'react'
import { OnboardingStepProps } from '../types'
import { getContainerStyle, getButtonStyle, applyButtonHover, resetButtonHover } from '../styles'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'

export function WelcomeStep({
  theme,
  onNext,
  isTransitioning
}: OnboardingStepProps): React.ReactElement<any> {
  const containerStyle = getContainerStyle(theme, isTransitioning)
  const buttonStyle = getButtonStyle(theme)

  const handleGetStarted = (): void => {
    onNext()
  }

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
        {/* Logo */}
        <img
          src={logoImage}
          alt="Overlay Logo"
          style={{
            width: '80px',
            height: '80px',
            marginBottom: '0px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.1s',
            opacity: 0
          }}
        />
        {/* App name */}
        <h1
          style={{
            fontSize: '72px',
            fontWeight: 400,
            fontFamily: "'Libre Baskerville', Georgia, serif",
            color: theme.text,
            margin: 0,
            marginBottom: '25px',
            letterSpacing: '-0.025em',
            lineHeight: 1,
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.3s',
            opacity: 0
          }}
        >
          overlay
        </h1>
        {/* Tagline */}
        <p
          style={{
            fontSize: '18px',
            color: theme.textSecondary,
            margin: 0,
            marginBottom: '40px',
            fontWeight: 400,
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.5s',
            opacity: 0
          }}
        >
          your personal, unified ai interaction layer
        </p>

        {/* Get Started Button */}
        <button
          style={{
            ...buttonStyle,
            width: 'auto',
            padding: '10px 24px',
            cursor: 'pointer',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.7s',
            opacity: 0
          }}
          onClick={handleGetStarted}
          onMouseEnter={(e) => applyButtonHover(e, theme, false)}
          onMouseLeave={(e) => resetButtonHover(e, theme)}
        >
          get started
        </button>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center'
        }}
      >
        <p
          style={{
            fontSize: '12px',
            marginTop: '30px',
            color: theme.textSecondary,
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.8s',
            opacity: 0,
            // @ts-expect-error - webkit property for electron drag region
            WebkitAppRegion: 'no-drag'
          }}
        >
          by continuing, you agree to our{'  '}
          <button
            style={{
              color: theme.accent,
              cursor: 'pointer',
              textDecoration: 'underline',
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              fontSize: 'inherit',
              display: 'inline-block'
            }}
            onClick={() => window.bridge?.openExternal?.('https://www.getoverlay.io/terms')}
          >
            terms of service
          </button>
          {' and '}
          <button
            style={{
              color: theme.accent,
              cursor: 'pointer',
              textDecoration: 'underline',
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              fontSize: 'inherit',
              display: 'inline-block'
            }}
            onClick={() => window.bridge?.openExternal?.('https://www.getoverlay.io/privacy')}
          >
            privacy policy
          </button>
        </p>
      </div>
    </div>
  )
}
