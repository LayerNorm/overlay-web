import React, { useState, useEffect } from 'react'
import { OnboardingTheme, saveUserProfile, loadUserProfile } from '../types'
import { getContainerStyle, getInputStyle } from '../styles'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'

interface NameStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
  onNameValidChange?: (isValid: boolean) => void
}

export function NameStep({
  theme,
  onNext,
  isTransitioning,
  onNameValidChange
}: NameStepProps): React.ReactElement<any> {
  const [userName, setUserName] = useState('')

  const containerStyle = getContainerStyle(theme, isTransitioning)

  // Check if name is valid (not empty after trimming)
  const isNameValid = userName.trim().length > 0

  // Notify parent of name validity changes
  useEffect(() => {
    onNameValidChange?.(isNameValid)
  }, [isNameValid, onNameValidChange])

  // Load existing name on mount
  useEffect(() => {
    const existingProfile = loadUserProfile()
    if (existingProfile?.displayName) {
      setUserName(existingProfile.displayName)
    }
  }, [])

  // Save profile when name changes (for next button to work)
  useEffect(() => {
    if (isNameValid) {
      saveUserProfile(userName.trim())
    }
  }, [userName, isNameValid])

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <img
          src={logoImage}
          alt="Overlay Logo"
          style={{
            width: '48px',
            height: '48px',
            marginBottom: '16px',
            animation: 'unblur 0.8s ease forwards',
            opacity: 0
          }}
        />
        <h2
          style={{
            fontSize: '28px',
            fontFamily: "'Libre Baskerville', Georgia, serif",
            fontWeight: 500,
            color: theme.text,
            margin: 0,
            marginBottom: '12px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.1s',
            opacity: 0
          }}
        >
          what should we call you?
        </h2>
        <input
          type="text"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isNameValid) {
              onNext()
            }
          }}
          placeholder="Your name"
          autoFocus
          style={getInputStyle(theme, false, '0.3s')}
        />
      </div>
    </div>
  )
}
