import { useState, useEffect, ReactElement } from 'react'
import { SettingsRow } from '../ui/SettingsRow'
import { Toggle } from '../ui/Toggle'
import { ImportNotesDialog } from './ImportNotesDialog'
import { Settings } from '../../hooks/useSettings'
import { Theme } from '../../utils/theme'

interface NotebookSettingsProps {
  settings: Settings
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  theme: Theme
}

export function NotebookSettings({
  settings,
  onUpdateSetting,
  theme
}: NotebookSettingsProps): ReactElement {
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [notesFolder, setNotesFolder] = useState('')

  useEffect(() => {
    window.bridge.getNotesFolder().then(setNotesFolder)
  }, [])

  const handleOpenFolder = (): void => {
    window.bridge.openNotesFolder()
  }

  return (
    <>
      <div>
        <SettingsRow
          title="Open New Note Every Time"
          description="Create a new note each time the notebook panel is opened"
          theme={theme}
        >
          <Toggle
            checked={settings.openNewNoteEveryTime}
            onChange={(checked) => onUpdateSetting('openNewNoteEveryTime', checked)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Paste Transcription in New Note"
          description="When holding the hotkey to transcribe, paste in a new note if panel was hidden"
          theme={theme}
        >
          <Toggle
            checked={settings.pasteTranscriptionInNewNote}
            onChange={(checked) => onUpdateSetting('pasteTranscriptionInNewNote', checked)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Access Tabs in Sidebar"
          description="Move tab navigation to the sidebar instead of the header"
          theme={theme}
        >
          <Toggle
            checked={settings.accessTabsInSidebar}
            onChange={(checked) => onUpdateSetting('accessTabsInSidebar', checked)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow title="Notes Location" description={notesFolder || 'Loading...'} theme={theme}>
          <button
            onClick={handleOpenFolder}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              textDecoration: 'underline',
              textDecorationThickness: '2px',
              textUnderlineOffset: '3px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span>Open Folder</span>
          </button>
        </SettingsRow>

        <SettingsRow
          title="Import Notes"
          description="Import notes from Obsidian, Bear, or Apple Notes"
          theme={theme}
        >
          <button
            onClick={() => setShowImportDialog(true)}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              textDecoration: 'underline',
              textDecorationThickness: '2px',
              textUnderlineOffset: '3px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span>Import</span>
          </button>
        </SettingsRow>

        <SettingsRow
          title="Panel Opacity"
          description={`${settings.notebookPanelOpacity}%`}
          theme={theme}
        >
          <input
            type="range"
            min="50"
            max="100"
            value={settings.notebookPanelOpacity}
            onChange={(e) => onUpdateSetting('notebookPanelOpacity', Number(e.target.value))}
            style={{
              width: 120,
              height: 4,
              appearance: 'none',
              background: `linear-gradient(to right, ${theme.accent} 0%, ${theme.accent} ${((settings.notebookPanelOpacity - 50) / 50) * 100}%, rgba(255,255,255,0.2) ${((settings.notebookPanelOpacity - 50) / 50) * 100}%, rgba(255,255,255,0.2) 100%)`,
              borderRadius: 2,
              cursor: 'pointer',
              outline: 'none'
            }}
          />
        </SettingsRow>
      </div>

      <ImportNotesDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        theme={theme}
      />
    </>
  )
}
