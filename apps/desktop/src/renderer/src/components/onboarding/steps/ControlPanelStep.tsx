import React from 'react'
import { OnboardingStepProps } from '../types'
import { getContainerStyle } from '../styles'
import { MessageCircle, Mic, Notebook, Globe } from 'lucide-react'

export function ControlPanelStep({
  theme,
  isTransitioning
}: OnboardingStepProps): React.ReactElement<any> {
  const containerStyle = getContainerStyle(theme, isTransitioning)

  const iconButtonStyle = (delay: string): React.CSSProperties => ({
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    background: theme.border,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'buttonAppear 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
    animationDelay: delay,
    opacity: 0,
    transform: 'scale(0)'
  })

  return (
    <div style={containerStyle}>
      <style>
        {`
          @keyframes controlPanelAppear {
            0% {
              opacity: 0;
              transform: scale(0.8) translateY(20px);
            }
            100% {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }
          @keyframes buttonAppear {
            0% {
              opacity: 0;
              transform: scale(0);
            }
            100% {
              opacity: 1;
              transform: scale(1);
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
          maxWidth: '600px',
          padding: '0 24px'
        }}
      >
        {/* Mock Overlay Window with glow - matches OverlayWindow layout */}
        <div
          style={{
            width: '220px',
            height: '52px',
            borderRadius: '26px',
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            marginBottom: '40px',
            boxShadow: `0 0 30px ${theme.accent}40, 0 0 60px ${theme.accent}20`,
            animation: 'controlPanelAppear 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            animationDelay: '0.1s',
            opacity: 0
          }}
        >
          {/* Chat */}
          <div style={iconButtonStyle('0.3s')}>
            <MessageCircle size={18} color={theme.text} strokeWidth={1.5} />
          </div>
          {/* Mic / Transcription */}
          <div style={iconButtonStyle('0.4s')}>
            <Mic size={18} color={theme.text} strokeWidth={1.5} />
          </div>
          {/* Notebook */}
          <div style={iconButtonStyle('0.5s')}>
            <Notebook size={18} color={theme.text} strokeWidth={1.5} />
          </div>
          {/* Browser */}
          <div style={iconButtonStyle('0.6s')}>
            <Globe size={18} color={theme.text} strokeWidth={1.5} />
          </div>
        </div>

        <h2
          style={{
            fontSize: '24px',
            fontWeight: 500,
            color: theme.text,
            margin: 0,
            marginBottom: '16px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.7s',
            opacity: 0,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }}
        >
          this is your control panel
        </h2>
        <p
          style={{
            fontSize: '15px',
            color: theme.textSecondary,
            margin: 0,
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.9s',
            opacity: 0,
            lineHeight: 1.6
          }}
        >
          access chats, notes, and the browser from here
          <br />
          agents are available in all three windows
        </p>
      </div>
    </div>
  )
}
