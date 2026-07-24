import { useState, useCallback } from 'react'
import { useSettings } from '../hooks/useSettings'
import { GeneralSettings } from '../components/settings/GeneralSettings'
import { ShortcutSettings } from '../components/settings/ShortcutSettings'
import { TranscriptionSettings } from '../components/settings/TranscriptionSettings'
import { AgentSettings } from '../components/settings/AgentSettings'
import { OutputSettings } from '../components/settings/OutputSettings'
import { ChatSettings } from '../components/settings/ChatSettings'
import { NotebookSettings } from '../components/settings/NotebookSettings'
import { BrowserSettings } from '../components/settings/BrowserSettings'
import { AccountSettings } from '../components/settings/AccountSettings'
import { ModelsSettings } from '../components/settings/ModelsSettings'
import { MemoryListPage } from './MemoryListPage'
import {
  BackIcon,
  SettingsIcon,
  KeyboardIcon,
  MicrophoneIcon,
  OutputIcon,
  ChatIcon,
  NotebookIcon,
  BrowserIcon,
  UserIcon
} from '../components/icons'
import { getTheme } from '../utils/theme'
import { TierBadge } from '../components/ui/TierBadge'
import { useSubscription } from '../hooks/useSubscription'
import { Bot, Brain, ChevronLeft, ChevronRight, Cpu, Plus, Search, Square } from 'lucide-react'

type SettingsTab =
  | 'general'
  | 'shortcuts'
  | 'transcription'
  | 'assistant'
  | 'memories'
  | 'output'
  | 'models'
  | 'chat'
  | 'notebook'
  | 'browser'
  | 'account'

interface SettingsPageProps {
  onBack: () => void
  onSignOut: () => void
  sidebarExpanded: boolean
  onToggleSidebar: () => void
}

const COLLAPSED_WIDTH = 68
const EXPANDED_WIDTH = 200
const TITLEBAR_HEIGHT = 52

const SETTINGS_ITEMS: {
  id: SettingsTab
  label: string
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>
}[] = [
  { id: 'general', label: 'general', icon: SettingsIcon },
  { id: 'shortcuts', label: 'shortcuts', icon: KeyboardIcon },
  { id: 'transcription', label: 'transcription', icon: MicrophoneIcon },
  { id: 'assistant', label: 'agent', icon: Bot },
  { id: 'memories', label: 'memories', icon: Brain },
  { id: 'output', label: 'output', icon: OutputIcon },
  { id: 'models', label: 'models', icon: Cpu },
  { id: 'chat', label: 'chat', icon: ChatIcon },
  { id: 'notebook', label: 'notes', icon: NotebookIcon },
  { id: 'browser', label: 'browser', icon: BrowserIcon }
]

export function SettingsPage({
  onBack,
  onSignOut,
  sidebarExpanded,
  onToggleSidebar
}: SettingsPageProps): React.ReactElement {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [memorySearchOpen, setMemorySearchOpen] = useState(false)
  const [memorySearchQuery, setMemorySearchQuery] = useState('')
  const [memorySelectMode, setMemorySelectMode] = useState(false)
  const [memoryAddDialogOpen, setMemoryAddDialogOpen] = useState(false)
  const { settings, updateSetting } = useSettings()
  const theme = getTheme(settings.darkMode, settings.lightThemePreset, settings.darkThemePreset)
  const subscription = useSubscription()

  const handleTabChange = useCallback(
    (tab: SettingsTab): void => {
      if (tab === settingsTab) return
      setSettingsTab(tab)
    },
    [settingsTab]
  )

  const handleBack = useCallback((): void => {
    onBack()
  }, [onBack])

  const isActive = (id: string): boolean => settingsTab === id

  const activeBg = settings.darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'
  const hoverBg = settings.darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'

  // Icon fixed at same x position whether collapsed or expanded — padding: '0 6px' keeps it static
  const rowStyle = (id: string): React.CSSProperties => ({
    width: '100%',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    background: isActive(id) ? activeBg : 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    padding: '0 6px',
    flexShrink: 0,
    overflow: 'hidden'
  })

  const labelStyle = (): React.CSSProperties => ({
    fontSize: '13px',
    fontFamily: "'Libre Baskerville', Georgia, serif",
    color: theme.text,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    maxWidth: sidebarExpanded ? '150px' : '0px',
    opacity: sidebarExpanded ? 1 : 0,
    transition: sidebarExpanded
      ? 'max-width 0.2s ease, opacity 0.12s ease 0.1s'
      : 'max-width 0.2s ease 0.02s, opacity 0.06s ease',
    lineHeight: 'normal',
    pointerEvents: 'none'
  })

  const iconContainer: React.CSSProperties = {
    width: '36px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        background: theme.background,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        display: 'flex',
        flexDirection: 'row',
        position: 'relative',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      {/* Drag region */}
      <div
        style={
          {
            WebkitAppRegion: 'drag',
            height: `${TITLEBAR_HEIGHT}px`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000
          } as React.CSSProperties
        }
      />

      <style>{`
        @keyframes settingsFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Sidebar */}
      <div
        style={{
          width: `${sidebarExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH}px`,
          transition: 'width 0.2s ease',
          height: '100%',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: theme.background,
          overflow: 'hidden',
          zIndex: 5,
          paddingTop: `${TITLEBAR_HEIGHT + 10}px`,
          paddingBottom: '16px',
          paddingLeft: '10px',
          paddingRight: '10px',
          boxSizing: 'border-box'
        }}
      >
        {/* Top spacer — centers items group vertically */}
        <div style={{ flex: 1 }} />

        {/* Settings items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {SETTINGS_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              title={label}
              style={rowStyle(id)}
              onMouseEnter={(e) => {
                if (!isActive(id)) e.currentTarget.style.background = hoverBg
              }}
              onMouseLeave={(e) => {
                if (!isActive(id)) e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={iconContainer}>
                <Icon color={theme.text} size={16} strokeWidth={1.5} />
              </span>
              <span style={labelStyle()}>{label}</span>
            </button>
          ))}

          {/* Account */}
          <button
            onClick={() => handleTabChange('account')}
            title="Account"
            style={rowStyle('account')}
            onMouseEnter={(e) => {
              if (!isActive('account')) e.currentTarget.style.background = hoverBg
            }}
            onMouseLeave={(e) => {
              if (!isActive('account')) e.currentTarget.style.background = 'transparent'
            }}
          >
            <span style={iconContainer}>
              <UserIcon color={theme.text} size={16} />
            </span>
            <span style={{ ...labelStyle(), display: 'flex', alignItems: 'center', gap: '6px' }}>
              account
              <TierBadge tier={subscription.tier} />
            </span>
          </button>
        </div>

        {/* Bottom spacer — equal to top spacer */}
        <div style={{ flex: 1 }} />

        {/* Back + Toggle row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <button
            onClick={handleBack}
            title="Back"
            style={{
              width: '100%',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              padding: '0 6px',
              flexShrink: 0,
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = hoverBg
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span style={iconContainer}>
              <BackIcon color={theme.text} size={16} />
            </span>
            <span style={labelStyle()}>back</span>
          </button>
          <button
            onClick={onToggleSidebar}
            title={sidebarExpanded ? 'Hide' : 'Show'}
            style={{
              width: '100%',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              padding: '0 6px',
              flexShrink: 0,
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = hoverBg
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span style={iconContainer}>
              {sidebarExpanded ? (
                <ChevronLeft size={16} strokeWidth={1.5} color={theme.text} />
              ) : (
                <ChevronRight size={16} strokeWidth={1.5} color={theme.text} />
              )}
            </span>
            <span style={labelStyle()}>{sidebarExpanded ? 'hide' : 'show'}</span>
          </button>
        </div>
      </div>

      {/* Right side */}
      <div
        style={{
          flex: 1,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0
        }}
      >
        <div style={{ height: `${TITLEBAR_HEIGHT}px`, flexShrink: 0 }} />
        <div
          style={{
            flex: 1,
            borderLeft: `1px solid ${theme.border}`,
            borderTop: `1px solid ${theme.border}`,
            borderTopLeftRadius: '8px',
            overflowY: 'auto',
            padding: '40px 60px 80px 40px'
          }}
        >
          <div key={settingsTab} style={{ animation: 'settingsFadeIn 0.2s ease-out' }}>
            {settingsTab === 'general' && (
              <GeneralSettings settings={settings} onUpdateSetting={updateSetting} theme={theme} />
            )}
            {settingsTab === 'shortcuts' && (
              <ShortcutSettings settings={settings} onUpdateSetting={updateSetting} theme={theme} />
            )}
            {settingsTab === 'transcription' && (
              <TranscriptionSettings
                settings={settings}
                onUpdateSetting={updateSetting}
                theme={theme}
              />
            )}
            {settingsTab === 'assistant' && (
              <AgentSettings settings={settings} onUpdateSetting={updateSetting} theme={theme} />
            )}
            {settingsTab === 'memories' && (
              <div
                style={{
                  height: 'calc(100vh - 172px)',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: '420px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                    marginBottom: '18px'
                  }}
                >
                  <div>
                    <h1
                      style={{
                        margin: 0,
                        color: theme.text,
                        fontSize: '24px',
                        fontWeight: 600,
                        fontFamily:
                          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
                      }}
                    >
                      Memories
                    </h1>
                    <p
                      style={{
                        margin: '6px 0 0',
                        color: theme.textSecondary,
                        fontSize: '13px',
                        lineHeight: '20px'
                      }}
                    >
                      Personal context synced from your Overlay account.
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {[
                      {
                        title: 'Search memories',
                        icon: Search,
                        active: memorySearchOpen,
                        onClick: () =>
                          setMemorySearchOpen((prev) => {
                            if (prev) setMemorySearchQuery('')
                            return !prev
                          })
                      },
                      {
                        title: 'Select memories',
                        icon: Square,
                        active: memorySelectMode,
                        onClick: () => setMemorySelectMode((prev) => !prev)
                      },
                      {
                        title: 'Add memory',
                        icon: Plus,
                        active: memoryAddDialogOpen,
                        onClick: () => setMemoryAddDialogOpen(true)
                      }
                    ].map(({ title, icon: Icon, active, onClick }) => (
                      <button
                        key={title}
                        title={title}
                        onClick={onClick}
                        style={{
                          width: '30px',
                          height: '30px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: active ? activeBg : 'transparent',
                          border: `1px solid ${active ? theme.border : 'transparent'}`,
                          borderRadius: '7px',
                          cursor: 'pointer',
                          color: active ? theme.text : theme.textSecondary,
                          transition: 'background 0.1s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (!active) e.currentTarget.style.background = hoverBg
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = active ? activeBg : 'transparent'
                        }}
                      >
                        <Icon size={14} />
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '10px',
                    overflow: 'hidden',
                    background: theme.surface
                  }}
                >
                  <MemoryListPage
                    theme={theme}
                    isSearchOpen={memorySearchOpen}
                    searchQuery={memorySearchQuery}
                    onSearchQueryChange={setMemorySearchQuery}
                    isSelectMode={memorySelectMode}
                    onSelectModeChange={setMemorySelectMode}
                    showAddDialog={memoryAddDialogOpen}
                    onAddDialogOpenChange={setMemoryAddDialogOpen}
                    loadFromBackend
                  />
                </div>
              </div>
            )}
            {settingsTab === 'output' && (
              <OutputSettings settings={settings} onUpdateSetting={updateSetting} theme={theme} />
            )}
            {settingsTab === 'models' && (
              <div>
                <h1
                  style={{
                    margin: 0,
                    color: theme.text,
                    fontSize: '24px',
                    fontWeight: 600,
                    fontFamily:
                      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
                  }}
                >
                  Models
                </h1>
                <p
                  style={{
                    margin: '6px 0 0',
                    color: theme.textSecondary,
                    fontSize: '13px',
                    lineHeight: '20px'
                  }}
                >
                  Choose which AI models appear in your chat model picker and set your default.
                </p>
                <div style={{ marginTop: '24px' }}>
                  <ModelsSettings theme={theme} />
                </div>
              </div>
            )}
            {settingsTab === 'chat' && (
              <ChatSettings settings={settings} onUpdateSetting={updateSetting} theme={theme} />
            )}
            {settingsTab === 'notebook' && (
              <NotebookSettings settings={settings} onUpdateSetting={updateSetting} theme={theme} />
            )}
            {settingsTab === 'browser' && (
              <BrowserSettings settings={settings} onUpdateSetting={updateSetting} theme={theme} />
            )}
            {settingsTab === 'account' && <AccountSettings theme={theme} onSignOut={onSignOut} />}
          </div>
        </div>
      </div>
    </div>
  )
}
