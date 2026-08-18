import React, { useCallback, useEffect, useState } from 'react'
import { OnboardingTheme } from '../types'
import { getContainerStyle, getButtonStyle, applyButtonHover, resetButtonHover } from '../styles'
import {
  dispatchAuthReady,
  getAuthFailureMessage,
  loadVerifiedAuthSession,
  startNativeSignIn
} from '../../../services/auth-service'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'
import { useAppBootstrap } from '../../../contexts/AppBootstrapContext'

interface AuthStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
}

function getAuthErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return code.includes('native_auth_secure_storage_unavailable')
    ? 'Allow Overlay to use macOS Keychain, then try again.'
    : 'Sign-in could not be completed. Please try again.'
}

export function AuthStep({ theme, onNext, isTransitioning }: AuthStepProps): React.ReactElement<any> {
  const [authStatus, setAuthStatus] = useState<string | null>(() => getAuthFailureMessage())
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const { refreshBootstrap } = useAppBootstrap()

  const containerStyle = getContainerStyle(theme, isTransitioning)
  const buttonStyle = getButtonStyle(theme)

  // Listen for session transfer from landing page (when user clicks "Open in Overlay")
  // This receives pre-authenticated session data directly without code exchange
  useEffect(() => {
    const unsubscribeSessionTransfer = window.bridge?.onSessionTransfer?.(async (data) => {
      console.log('[Auth] Received session transfer from landing page')
      try {
        const session = await loadVerifiedAuthSession()
        if (!session || session.user.id !== data.user.id) {
          dispatchAuthReady(false)
          throw new Error('native_auth_bootstrap_verification_failed')
        }
        dispatchAuthReady(true)
        console.log('[Auth] Session transfer complete')
        setAuthStatus('welcome to overlay!')

        // Refresh bootstrap so the model catalog and entitlements are current
        await refreshBootstrap()

        // Short delay to show success message, then proceed
        setTimeout(() => {
          onNext()
        }, 1000)
      } catch (error) {
        console.error('[Auth] Session transfer failed:', error)
        setAuthStatus(
          getAuthFailureMessage() ??
            'Sign-in reached the app, but the server could not verify the session. Please try again.'
        )
        setIsAuthenticating(false)
      }
    })

    return () => {
      unsubscribeSessionTransfer?.()
    }
  }, [onNext, refreshBootstrap])

  useEffect(() => {
    const unsubscribeAuthError = window.bridge?.onAuthError?.((data) => {
      setAuthStatus(getAuthErrorMessage(data.error))
      setIsAuthenticating(false)
    })

    return () => {
      unsubscribeAuthError?.()
    }
  }, [])

  const handleSignIn = useCallback(async () => {
    setAuthStatus('opening browser...')
    setIsAuthenticating(true)

    try {
      await startNativeSignIn(false)
      setTimeout(() => {
        setAuthStatus('complete sign-in in your browser')
      }, 1500)
    } catch (error) {
      console.error('[Auth] Failed to start browser sign-in:', error)
      setAuthStatus(getAuthErrorMessage(error))
      setIsAuthenticating(false)
    }
  }, [])

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center' }}>
        {/* Logo */}
        <img
          src={logoImage}
          alt="Overlay Logo"
          style={{
            width: '50px',
            height: '50px',
            marginBottom: '10px',
            animation: 'unblur 0.8s ease forwards',
            opacity: 0
          }}
        />
        <h2
          style={{
            fontSize: '28px',
            fontWeight: 500,
            color: theme.text,
            margin: 0,
            marginBottom: '24px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.1s',
            opacity: 0
          }}
        >
          sign in
        </h2>
        <p
          style={{
            fontSize: '15px',
            color: theme.textSecondary,
            margin: 0,
            marginBottom: '32px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.2s',
            opacity: 0
          }}
        >
          sync your settings across devices
        </p>
        {authStatus && (
          <p
            style={{
              fontSize: '14px',
              color: theme.accent,
              margin: 0,
              marginBottom: '24px',
              animation: 'unblur 0.5s ease forwards'
            }}
          >
            {authStatus}
          </p>
        )}

        <button
          style={{
            ...buttonStyle,
            animationDelay: '0.3s',
            width: 'auto',
            padding: '10px 24px',
            opacity: isAuthenticating ? 0.7 : 0,
            cursor: isAuthenticating ? 'wait' : 'pointer'
          }}
          onClick={handleSignIn}
          disabled={isAuthenticating}
          onMouseEnter={(e) => applyButtonHover(e, theme, isAuthenticating)}
          onMouseLeave={(e) => resetButtonHover(e, theme)}
        >
          {isAuthenticating ? 'signing in...' : 'sign in'}
        </button>
      </div>
    </div>
  )
}
