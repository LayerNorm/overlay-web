import React, { useState, useEffect } from 'react'
import { OnboardingStepProps } from '../types'
import { getContainerStyle } from '../styles'

export function ReduceFrictionStep({
  theme,
  isTransitioning
}: OnboardingStepProps): React.ReactElement<any> {
  const containerStyle = getContainerStyle(theme, isTransitioning)
  const [showSecondPhrase, setShowSecondPhrase] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSecondPhrase(true)
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div style={containerStyle}>
      <style>
        {`
          @keyframes blurFadeIn {
            0% {
              opacity: 0;
              filter: blur(12px);
              transform: scale(0.95);
            }
            100% {
              opacity: 1;
              filter: blur(0);
              transform: scale(1);
            }
          }
          @keyframes blurFadeOut {
            0% {
              opacity: 1;
              filter: blur(0);
              transform: scale(1);
            }
            100% {
              opacity: 0;
              filter: blur(12px);
              transform: scale(0.95);
            }
          }
        `}
      </style>
      <div
        style={{
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          maxWidth: '500px',
          position: 'relative'
        }}
      >
        <h2
          style={{
            fontSize: '32px',
            fontWeight: 400,
            fontFamily: "'Libre Baskerville', Georgia, serif",
            color: theme.text,
            margin: 0,
            marginBottom: '16px',
            position: 'absolute',
            animation: showSecondPhrase
              ? 'blurFadeOut 0.8s ease forwards'
              : 'blurFadeIn 0.8s ease forwards'
          }}
        >
          reduce the friction in your work
        </h2>
        <h2
          style={{
            fontSize: '32px',
            fontWeight: 400,
            fontFamily: "'Libre Baskerville', Georgia, serif",
            color: theme.text,
            margin: 0,
            marginBottom: '16px',
            opacity: 0,
            animation: showSecondPhrase ? 'blurFadeIn 0.8s ease 0.3s forwards' : 'none'
          }}
        >
          reduce your work
        </h2>
      </div>
    </div>
  )
}
