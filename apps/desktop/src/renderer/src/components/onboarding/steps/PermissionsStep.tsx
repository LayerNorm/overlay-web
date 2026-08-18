import React, { useState, useEffect } from 'react'
import { OnboardingStepProps } from '../types'
import { getContainerStyle } from '../styles'
import { Mic, User, Zap, Check } from 'lucide-react'

interface PermissionCardProps {
  icon: React.ReactNode
  title: string
  description: string
  isGranted: boolean
  onRequest: () => void
  theme: OnboardingStepProps['theme']
  animationDelay: string
}

function PermissionCard({
  icon,
  title,
  description,
  isGranted,
  onRequest,
  theme,
  animationDelay
}: PermissionCardProps): React.ReactElement<any> {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        padding: '16px',
        gap: '16px',
        background: theme.surface,
        border: `1px solid ${isGranted ? theme.accent : theme.border}`,
        borderRadius: '12px',
        opacity: 0,
        animation: 'unblur 0.8s ease forwards',
        animationDelay,
        // @ts-expect-error - webkit property for electron drag region
        WebkitAppRegion: 'no-drag'
      }}
    >
      {/* Icon container */}
      <div
        style={{
          width: '40px',
          height: '40px',
          minWidth: '40px',
          borderRadius: '10px',
          background: isGranted ? `${theme.accent}15` : theme.border,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isGranted ? theme.accent : theme.textSecondary
        }}
      >
        {icon}
      </div>

      {/* Text content - takes remaining space */}
      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: theme.text,
            marginBottom: '4px',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
            textAlign: 'left'
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: '12px',
            color: theme.textSecondary,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
            textAlign: 'left'
          }}
        >
          {description}
        </div>
      </div>

      {/* Action button or granted badge */}
      <div style={{ flexShrink: 0 }}>
        {isGranted ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: theme.accent,
              fontSize: '13px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
            }}
          >
            <Check size={16} />
            <span>Granted</span>
          </div>
        ) : (
          <button
            onClick={onRequest}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              color: theme.toggleThumb,
              background: theme.buttonBg,
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.buttonHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme.buttonBg
            }}
          >
            Grant
          </button>
        )}
      </div>
    </div>
  )
}

export function PermissionsStep({
  theme,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onNext,
  isTransitioning
}: OnboardingStepProps): React.ReactElement<any> {
  const containerStyle = getContainerStyle(theme, isTransitioning)

  const [micPermission, setMicPermission] = useState(false)
  const [accessibilityPermission, setAccessibilityPermission] = useState(false)
  const [systemEventsPermission, setSystemEventsPermission] = useState(false)
  const [systemEventsRequested, setSystemEventsRequested] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _allGranted = micPermission && accessibilityPermission && systemEventsPermission

  useEffect(() => {
    const checkPermissions = async (): Promise<void> => {
      try {
        const mic = await window.bridge?.checkMicrophonePermission?.()
        const accessibility = await window.bridge?.checkAccessibilityPermission?.()
        setMicPermission(mic === 'granted')
        setAccessibilityPermission(accessibility === true)

        // Only check system events if user has clicked Grant (to avoid prompting on page load)
        if (systemEventsRequested) {
          const systemEvents = await window.bridge?.checkSystemEventsPermission?.()
          setSystemEventsPermission(systemEvents === true)
        }
      } catch (e) {
        console.error('Failed to check permissions:', e)
      }
    }
    checkPermissions()
    const interval = setInterval(checkPermissions, 1000)
    return () => clearInterval(interval)
  }, [systemEventsRequested])

  const requestMicrophone = async (): Promise<void> => {
    try {
      const result = await window.bridge?.requestMicrophonePermission?.()
      setMicPermission(result === 'granted')
    } catch (e) {
      console.error('Failed to request microphone permission:', e)
    }
  }

  const requestAccessibility = async (): Promise<void> => {
    try {
      await window.bridge?.requestAccessibilityPermission?.()
    } catch (e) {
      console.error('Failed to request accessibility permission:', e)
    }
  }

  const requestSystemEvents = async (): Promise<void> => {
    try {
      setSystemEventsRequested(true)
      await window.bridge?.requestSystemEventsPermission?.()
    } catch (e) {
      console.error('Failed to request system events permission:', e)
    }
  }

  return (
    <div style={containerStyle}>
      <div
        style={{
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          maxWidth: '520px',
          width: '100%',
          padding: '0 24px'
        }}
      >
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 500,
            color: theme.text,
            margin: 0,
            marginBottom: '12px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.1s',
            opacity: 0,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }}
        >
          <span style={{ fontFamily: "'Libre Baskerville', Georgia, serif", fontWeight: 400 }}>
            overlay
          </span>{' '}
          needs permissions to work
        </h2>
        <p
          style={{
            fontSize: '14px',
            color: theme.textSecondary,
            margin: 0,
            marginBottom: '24px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.2s',
            opacity: 0
          }}
        >
          these are required for voice input and automation
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            width: '100%',
            marginBottom: '32px'
          }}
        >
          <PermissionCard
            icon={<Mic size={18} />}
            title="Microphone"
            description="For voice transcription"
            isGranted={micPermission}
            onRequest={requestMicrophone}
            theme={theme}
            animationDelay="0.3s"
          />
          <PermissionCard
            icon={<User size={18} />}
            title="Accessibility"
            description="For text pasting and automation"
            isGranted={accessibilityPermission}
            onRequest={requestAccessibility}
            theme={theme}
            animationDelay="0.4s"
          />
          <PermissionCard
            icon={<Zap size={18} />}
            title="System Events"
            description="For keyboard shortcuts"
            isGranted={systemEventsPermission}
            onRequest={requestSystemEvents}
            theme={theme}
            animationDelay="0.5s"
          />
        </div>
      </div>
    </div>
  )
}
