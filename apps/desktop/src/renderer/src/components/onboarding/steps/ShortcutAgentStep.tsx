import React, { useState, useEffect } from 'react'
import { OnboardingTheme, formatHotkeyDisplay } from '../types'
import { HotkeyDialog } from '../../ui/HotkeyDialog'
// Icons removed, using logo instead
import {
  getContainerStyle,
  getTitleStyle,
  getSubtitleStyle,
  getHotkeyBadgeStyle
} from '../styles'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'

interface ShortcutAgentStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
  initialHotkey: string
  onHotkeyChange: (hotkey: string) => void
}

export function ShortcutAgentStep({
  theme,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onNext,
  isTransitioning,
  initialHotkey,
  onHotkeyChange
}: ShortcutAgentStepProps): React.ReactElement<any> {
  const [agentHotkey, setAgentHotkey] = useState(initialHotkey)
  const [showHotkeyDialog, setShowHotkeyDialog] = useState(false)

  // Ensure panel hotkeys are initialized when entering this step
  useEffect(() => {
    void window.bridge?.initializeOnboardingPanelHotkeys?.()
  }, [])

  const containerStyle = getContainerStyle(theme, isTransitioning)
  const hotkeyBadgeStyle = getHotkeyBadgeStyle(theme)

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center', maxWidth: '550px' }}>
        <img
          src={logoImage}
          alt="Overlay"
          style={{
            width: '32px',
            height: '32px',
            marginBottom: '16px',
            animation: 'unblur 0.8s ease forwards',
            animationDelay: '0.1s',
            opacity: 0
          }}
        />
        <h2 style={{ ...getTitleStyle(theme, '0.2s'), marginBottom: '30px' }}>agent</h2>
        <p style={{ ...getSubtitleStyle(theme, '0.3s'), lineHeight: '2.2' }}>
          <span
            onClick={() => setShowHotkeyDialog(true)}
            style={hotkeyBadgeStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.buttonHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme.surface
            }}
          >
            {formatHotkeyDisplay(agentHotkey)}
          </span>
          <br />
          press to toggle agent
          <br />
          <span style={{ fontSize: '13px', opacity: 0.85 }}>
            or say &quot;
            <span style={{ fontFamily: "'Libre Baskerville', Georgia, serif", fontWeight: 400 }}>
              overlay
            </span>
            &quot; in push to talk mode
          </span>
        </p>
      </div>
      <HotkeyDialog
        isOpen={showHotkeyDialog}
        onClose={() => setShowHotkeyDialog(false)}
        onSave={(hotkey) => {
          setAgentHotkey(hotkey)
          onHotkeyChange(hotkey)
        }}
        currentHotkey={agentHotkey}
        title="Press the hotkey you want to use for the agent:"
        theme={theme}
      />
    </div>
  )
}
