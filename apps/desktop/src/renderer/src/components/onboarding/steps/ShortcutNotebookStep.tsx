import React, { useState, useEffect } from 'react'
import { OnboardingTheme } from '../types'
import { HotkeyDialog } from '../../ui/HotkeyDialog'
import { ImportNotesDialog } from '../../settings/ImportNotesDialog'
import { Download } from 'lucide-react'
import {
  getContainerStyle,
  getTitleStyle,
  getSubtitleStyle,
  getHotkeyBadgeStyle,
  getSecondaryButtonStyle,
  applySecondaryButtonHover,
  resetSecondaryButtonHover
} from '../styles'
import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'

interface ShortcutNotebookStepProps {
  theme: OnboardingTheme
  onNext: () => void
  isTransitioning: boolean
  initialHotkey: string
  onHotkeyChange: (hotkey: string) => void
}

export function ShortcutNotebookStep({
  theme,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onNext,
  isTransitioning,
  initialHotkey,
  onHotkeyChange
}: ShortcutNotebookStepProps): React.ReactElement<any> {
  const [notebookHotkey, setNotebookHotkey] = useState(initialHotkey)
  const [showHotkeyDialog, setShowHotkeyDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)

  // Ensure panel hotkeys are initialized when entering this step
  useEffect(() => {
    void window.bridge?.initializeOnboardingPanelHotkeys?.()
  }, [])

  const containerStyle = getContainerStyle(theme, isTransitioning)
  const secondaryButtonStyle = getSecondaryButtonStyle(theme)
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
        <h2 style={{ ...getTitleStyle(theme, '0.2s'), marginBottom: '16px' }}>notes</h2>
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
            {notebookHotkey}
          </span>
          <br />
          press to toggle notebook
          <br />
          <span style={{ fontSize: '13px', opacity: 0.85 }}>
            hold the hotkey to speak directly into the note
          </span>
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
            style={{
              ...secondaryButtonStyle,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: `1px solid ${theme.border}`
            }}
            onClick={() => setShowImportDialog(true)}
            onMouseEnter={(e) => applySecondaryButtonHover(e, theme)}
            onMouseLeave={(e) => resetSecondaryButtonHover(e)}
          >
            <Download size={14} />
            import notes
          </button>
        </div>
      </div>
      <HotkeyDialog
        isOpen={showHotkeyDialog}
        onClose={() => setShowHotkeyDialog(false)}
        onSave={(hotkey) => {
          setNotebookHotkey(hotkey)
          onHotkeyChange(hotkey)
        }}
        currentHotkey={notebookHotkey}
        title="Press the hotkey you want to use for the notebook panel:"
        theme={theme}
      />
      <ImportNotesDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        theme={theme}
      />
    </div>
  )
}
