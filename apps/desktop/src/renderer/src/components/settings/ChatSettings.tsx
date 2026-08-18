import { useState } from 'react'
import { Check, Hand, ShieldAlert } from 'lucide-react'
import { SettingsRow } from '../ui/SettingsRow'
import { Toggle } from '../ui/Toggle'
import { Settings } from '../../hooks/useSettings'
import { Theme } from '../../utils/theme'
import type { ChatToolPermissionMode } from '../../../../types/agent-permissions'

interface ChatSettingsProps {
  settings: Settings
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  theme: Theme
}

export function ChatSettings({
  settings,
  onUpdateSetting,
  theme
}: ChatSettingsProps): React.ReactElement<any> {
  const [permissionPending, setPermissionPending] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)

  const selectPermissionMode = async (mode: ChatToolPermissionMode): Promise<void> => {
    if (permissionPending || mode === settings.chatToolPermissionMode) return
    setPermissionPending(true)
    setPermissionError(null)
    try {
      const result = await window.bridge.setChatToolPermissionMode(mode)
      onUpdateSetting('chatToolPermissionMode', result.mode)
      if (!result.updated && result.error) {
        setPermissionError('The permission setting could not be updated.')
      }
    } catch {
      setPermissionError('The permission setting could not be updated.')
    } finally {
      setPermissionPending(false)
    }
  }

  const permissionOptions: Array<{
    mode: ChatToolPermissionMode
    title: string
    description: string
    icon: typeof Hand
    dangerous?: boolean
  }> = [
    {
      mode: 'ask_for_approval',
      title: 'Ask for approval',
      description:
        'Ask before chat runs commands or accesses files, apps, integrations, or the internet.',
      icon: Hand
    },
    {
      mode: 'full_access',
      title: 'Full access',
      description:
        'Run commands and access files, apps, integrations, and the internet without asking.',
      icon: ShieldAlert,
      dangerous: true
    }
  ]
  const dangerColor = theme.isDark ? '#ff7a45' : '#c2410c'
  const dangerSecondary = theme.isDark ? '#ff9a70' : '#9a3412'
  const dangerBackground = theme.isDark
    ? 'rgba(255, 122, 69, 0.08)'
    : 'rgba(194, 65, 12, 0.08)'

  return (
    <>
      <div>
        <section
          aria-labelledby="chat-command-permissions-title"
          style={{
            padding: '0 0 24px',
            borderBottom: `1px solid ${theme.border}`
          }}
        >
          <div
            id="chat-command-permissions-title"
            style={{
              color: theme.text,
              fontSize: '14px',
              fontWeight: 600,
              marginBottom: '6px'
            }}
          >
            Chat command permissions
          </div>
          <div
            style={{
              color: theme.textSecondary,
              fontSize: '12px',
              lineHeight: '18px',
              marginBottom: '14px'
            }}
          >
            Choose how desktop chat approves operations on your Mac.
          </div>

          <div
            role="radiogroup"
            aria-label="Chat command permissions"
            style={{
              overflow: 'hidden',
              border: `1px solid ${theme.border}`,
              borderRadius: '12px',
              background: theme.surface
            }}
          >
            {permissionOptions.map(({ mode, title, description, icon: Icon, dangerous }, index) => {
              const selected = settings.chatToolPermissionMode === mode
              const selectedColor = dangerous ? dangerColor : theme.text
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={permissionPending}
                  onClick={() => void selectPermissionMode(mode)}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '32px minmax(0, 1fr) 22px',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '14px 16px',
                    border: 'none',
                    borderTop: index === 0 ? 'none' : `1px solid ${theme.border}`,
                    background: selected
                      ? dangerous
                        ? dangerBackground
                        : theme.buttonHover
                      : 'transparent',
                    color: selected ? selectedColor : theme.text,
                    textAlign: 'left',
                    cursor: permissionPending ? 'wait' : 'pointer',
                    opacity: permissionPending ? 0.7 : 1,
                    transition: 'background 120ms ease, opacity 120ms ease'
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: '30px',
                      height: '30px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '8px',
                      color: selected ? selectedColor : theme.textSecondary
                    }}
                  >
                    <Icon size={20} strokeWidth={1.7} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '14px',
                        fontWeight: 550,
                        marginBottom: '3px'
                      }}
                    >
                      {title}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        color: selected && dangerous ? dangerSecondary : theme.textSecondary,
                        fontSize: '12px',
                        lineHeight: '17px'
                      }}
                    >
                      {description}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: selectedColor,
                      opacity: selected ? 1 : 0
                    }}
                  >
                    <Check size={18} strokeWidth={2} />
                  </span>
                </button>
              )
            })}
          </div>

          {settings.chatToolPermissionMode === 'full_access' ? (
            <div
              role="status"
              style={{
                marginTop: '10px',
                color: dangerColor,
                fontSize: '12px',
                lineHeight: '18px'
              }}
            >
              Full access is not sandboxed. Commands run with your macOS user permissions.
            </div>
          ) : null}
          {permissionError ? (
            <div role="alert" style={{ marginTop: '10px', color: '#ef6a6a', fontSize: '12px' }}>
              {permissionError}
            </div>
          ) : null}
        </section>

        <SettingsRow
          title="Open New Chat Every Time"
          description="Create a new chat each time the chat panel is opened"
          theme={theme}
        >
          <Toggle
            checked={settings.openNewChatEveryTime}
            onChange={(checked) => onUpdateSetting('openNewChatEveryTime', checked)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Paste Transcription in New Chat"
          description="When holding the hotkey to transcribe, paste in a new chat if panel was hidden"
          theme={theme}
        >
          <Toggle
            checked={settings.pasteTranscriptionInNewChat}
            onChange={(checked) => onUpdateSetting('pasteTranscriptionInNewChat', checked)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Show Retrieved Memories"
          description="Show context memories retrieved for each user message in chat"
          theme={theme}
        >
          <Toggle
            checked={settings.showRetrievedMemoriesInChat}
            onChange={(checked) => onUpdateSetting('showRetrievedMemoriesInChat', checked)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Show Added Memories"
          description="Show memories extracted and added after assistant responses"
          theme={theme}
        >
          <Toggle
            checked={settings.showAddedMemoriesInChat}
            onChange={(checked) => onUpdateSetting('showAddedMemoriesInChat', checked)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Access Tabs in Sidebar"
          description="Move tab navigation to the sidebar instead of the header"
          theme={theme}
        >
          <Toggle
            checked={settings.chatAccessTabsInSidebar}
            onChange={(checked) => onUpdateSetting('chatAccessTabsInSidebar', checked)}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Panel Opacity"
          description={`${settings.chatPanelOpacity}%`}
          theme={theme}
        >
          <input
            type="range"
            min="50"
            max="100"
            value={settings.chatPanelOpacity}
            onChange={(e) => onUpdateSetting('chatPanelOpacity', Number(e.target.value))}
            style={{
              width: 120,
              height: 4,
              appearance: 'none',
              background: `linear-gradient(to right, ${theme.accent} 0%, ${theme.accent} ${((settings.chatPanelOpacity - 50) / 50) * 100}%, rgba(255,255,255,0.2) ${((settings.chatPanelOpacity - 50) / 50) * 100}%, rgba(255,255,255,0.2) 100%)`,
              borderRadius: 2,
              cursor: 'pointer',
              outline: 'none'
            }}
          />
        </SettingsRow>
      </div>
    </>
  )
}
