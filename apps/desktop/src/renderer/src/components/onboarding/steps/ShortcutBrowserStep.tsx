import React, { useState, useEffect } from 'react'
import { OnboardingTheme, formatHotkeyDisplay } from '../types'
import { HotkeyDialog } from '../../ui/HotkeyDialog'
import { Download } from 'lucide-react'
import {
  getContainerStyle,
  getTitleStyle,
  getSubtitleStyle,
  getHotkeyBadgeStyle
} from '../styles'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'

interface ShortcutBrowserStepProps {
  theme: OnboardingTheme
  onComplete: () => void
  isTransitioning: boolean
  initialHotkey: string
  onHotkeyChange: (hotkey: string) => void
}

export function ShortcutBrowserStep({
  theme,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onComplete,
  isTransitioning,
  initialHotkey,
  onHotkeyChange
}: ShortcutBrowserStepProps): React.ReactElement<any> {
  const [browserHotkey, setBrowserHotkey] = useState(initialHotkey)
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
        <h2 style={{ ...getTitleStyle(theme, '0.2s'), marginBottom: '30px' }}>browse</h2>
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
            {formatHotkeyDisplay(browserHotkey)}
          </span>
          <br />
          press to toggle browser
        </p>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            animation: 'fadeSlideIn 0.8s ease forwards',
            animationDelay: '0.6s',
            opacity: 0,
            // @ts-expect-error - webkit property for electron drag region
            WebkitAppRegion: 'no-drag'
          }}
        >
          <button
            disabled
            style={{
              padding: '10px 16px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              border: 'none',
              borderRadius: '8px',
              background: 'transparent',
              color: theme.textDisabled,
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: 0.5
            }}
            title="Import browser data (coming soon)"
          >
            <Download size={14} />
            import browser data (coming soon)
          </button>
        </div>
      </div>
      <HotkeyDialog
        isOpen={showHotkeyDialog}
        onClose={() => setShowHotkeyDialog(false)}
        onSave={(hotkey) => {
          setBrowserHotkey(hotkey)
          onHotkeyChange(hotkey)
        }}
        currentHotkey={browserHotkey}
        title="Press the hotkey you want to use for the browser panel:"
        theme={theme}
      />
    </div>
  )
}
