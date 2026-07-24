import { useState, ReactElement } from 'react'
import { SettingsRow } from '../ui/SettingsRow'
import { HotkeyDialog } from '../ui/HotkeyDialog'
import { Settings } from '../../hooks/useSettings'
import { Theme } from '../../utils/theme'

interface ShortcutSettingsProps {
  settings: Settings
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  theme: Theme
}

type ActiveDialog =
  | 'transcription'
  | 'pushToTalk'
  | 'assistant'
  | 'chat'
  | 'notebook'
  | 'browser'
  | null

export function ShortcutSettings({
  settings,
  onUpdateSetting,
  theme
}: ShortcutSettingsProps): ReactElement {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null)

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: theme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    margin: '28px 0 0 0',
    padding: '0 0 10px 0',
    borderBottom: `1px solid ${theme.border}`,
    fontFamily: 'system-ui, -apple-system, sans-serif'
  }

  const hotkeyButtonStyle: React.CSSProperties = {
    padding: '6px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: theme.text,
    background: 'transparent',
    border: `2px solid ${theme.text}`,
    cursor: 'pointer',
    transition: 'background 0.15s ease'
  }

  return (
    <>
      <div>
        {/* Transcription section */}
        <p style={sectionHeaderStyle}>Transcription</p>

        <SettingsRow
          title="Transcription Hotkey"
          description="Press to start transcription, press again to stop"
          theme={theme}
        >
          <button
            onClick={() => setActiveDialog('transcription')}
            style={hotkeyButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {settings.transcriptionModeHotkey}
          </button>
        </SettingsRow>

        <SettingsRow
          title="Push to Talk Hotkey"
          description="Hold to record, release to transcribe"
          theme={theme}
        >
          <button
            onClick={() => setActiveDialog('pushToTalk')}
            style={hotkeyButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {settings.pushToTalkHotkey}
          </button>
        </SettingsRow>

        {/* Agent section */}
        <p style={{ ...sectionHeaderStyle, marginTop: 32 }}>Agent</p>

        <SettingsRow
          title="Agent Hotkey"
          description="Keyboard shortcut to activate the AI agent"
          theme={theme}
        >
          <button
            onClick={() => setActiveDialog('assistant')}
            style={hotkeyButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {settings.assistantModeHotkey}
          </button>
        </SettingsRow>

        {/* Panels section */}
        <p style={{ ...sectionHeaderStyle, marginTop: 32 }}>Panels</p>

        <SettingsRow
          title="Chat Panel"
          description="Keyboard shortcut to toggle the chat panel"
          theme={theme}
        >
          <button
            onClick={() => setActiveDialog('chat')}
            style={hotkeyButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {settings.chatPanelHotkey || 'Not set'}
          </button>
        </SettingsRow>

        <SettingsRow
          title="Notebook Panel"
          description="Keyboard shortcut to toggle the notebook panel"
          theme={theme}
        >
          <button
            onClick={() => setActiveDialog('notebook')}
            style={hotkeyButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {settings.notebookPanelHotkey || 'Not set'}
          </button>
        </SettingsRow>

        <SettingsRow
          title="Browser Panel"
          description="Keyboard shortcut to toggle the browser panel"
          theme={theme}
        >
          <button
            onClick={() => setActiveDialog('browser')}
            style={hotkeyButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {settings.browserPanelHotkey || 'Not set'}
          </button>
        </SettingsRow>
      </div>

      <HotkeyDialog
        isOpen={activeDialog === 'transcription'}
        onClose={() => setActiveDialog(null)}
        onSave={(hotkey) => {
          onUpdateSetting('transcriptionModeHotkey', hotkey)
          window.bridge.updateTranscriptionModeHotkey(hotkey)
        }}
        currentHotkey={settings.transcriptionModeHotkey}
        title="Press the hotkey you want to use for transcription mode:"
        theme={theme}
      />

      <HotkeyDialog
        isOpen={activeDialog === 'pushToTalk'}
        onClose={() => setActiveDialog(null)}
        onSave={(hotkey) => {
          onUpdateSetting('pushToTalkHotkey', hotkey)
          window.bridge.updatePushToTalkHotkey(hotkey)
        }}
        currentHotkey={settings.pushToTalkHotkey}
        title="Press the hotkey you want to hold for push to talk:"
        theme={theme}
        onSameAsTranscription={() => {
          onUpdateSetting('pushToTalkHotkey', settings.transcriptionModeHotkey)
          window.bridge.updatePushToTalkHotkey(settings.transcriptionModeHotkey)
        }}
      />

      <HotkeyDialog
        isOpen={activeDialog === 'assistant'}
        onClose={() => setActiveDialog(null)}
        onSave={(hotkey) => {
          onUpdateSetting('assistantModeHotkey', hotkey)
          window.bridge.updateAssistantModeHotkey(hotkey)
        }}
        currentHotkey={settings.assistantModeHotkey}
        title="Press the hotkey you want to use for assistant mode:"
        theme={theme}
      />

      <HotkeyDialog
        isOpen={activeDialog === 'chat'}
        onClose={() => setActiveDialog(null)}
        onSave={(hotkey) => {
          onUpdateSetting('chatPanelHotkey', hotkey)
          window.bridge.updateChatPanelHotkey(hotkey)
        }}
        currentHotkey={settings.chatPanelHotkey}
        title="Press the hotkey you want to use to toggle the chat panel:"
        theme={theme}
      />

      <HotkeyDialog
        isOpen={activeDialog === 'notebook'}
        onClose={() => setActiveDialog(null)}
        onSave={(hotkey) => {
          onUpdateSetting('notebookPanelHotkey', hotkey)
          window.bridge.updateNotebookPanelHotkey(hotkey)
        }}
        currentHotkey={settings.notebookPanelHotkey}
        title="Press the hotkey you want to use to toggle the notebook panel:"
        theme={theme}
      />

      <HotkeyDialog
        isOpen={activeDialog === 'browser'}
        onClose={() => setActiveDialog(null)}
        onSave={(hotkey) => {
          onUpdateSetting('browserPanelHotkey', hotkey)
          window.bridge.updateBrowserPanelHotkey?.(hotkey)
        }}
        currentHotkey={settings.browserPanelHotkey}
        title="Press the hotkey you want to use to toggle the browser panel:"
        theme={theme}
      />
    </>
  )
}
