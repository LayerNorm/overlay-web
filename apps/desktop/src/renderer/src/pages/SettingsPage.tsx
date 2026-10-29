import { useState } from 'react'
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
import { WorkspaceSettings } from '../components/settings/WorkspaceSettings'
import { ModelsSettings } from '../components/settings/ModelsSettings'
import { MemoryListPage } from './MemoryListPage'
import { getTheme } from '../utils/theme'
import { OverlayMark } from '@overlay/ui'
import {
  ShellAdapterProvider,
  UnifiedSidebar,
  type PrimaryRailItem,
} from '@overlay/shell-react'
import { desktopShellAdapter } from '../shell/DesktopShellAdapter'
import { DesktopWorkspaceSwitcher } from '../shell/DesktopWorkspaceSwitcher'
import { DESKTOP_SETTINGS_GROUPS, DESKTOP_SETTINGS_ITEMS } from '../shell/navigation'
import { useDesktopShellNav } from '../shell/useDesktopShellNav'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { ArrowLeft, Plus, Search, Square } from 'lucide-react'

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
  | 'workspace'
  | 'account'

interface SettingsPageProps {
  onBack: () => void
  onSignOut: () => void
}

const TITLEBAR_HEIGHT = 52

export function SettingsPage({
  onBack,
  onSignOut
}: SettingsPageProps): React.ReactElement<any> {
  const { activeWorkspaceId } = useWorkspace()
  const shellNav = useDesktopShellNav(activeWorkspaceId)
  const settingsTab = shellNav.settingsSection as SettingsTab
  const [memorySearchOpen, setMemorySearchOpen] = useState(false)
  const [memorySearchQuery, setMemorySearchQuery] = useState('')
  const [memorySelectMode, setMemorySelectMode] = useState(false)
  const [memoryAddDialogOpen, setMemoryAddDialogOpen] = useState(false)
  const { settings, updateSetting } = useSettings()
  const theme = getTheme(settings.darkMode, settings.lightThemePreset, settings.darkThemePreset)
  const settingsPanelNav = {
    items: DESKTOP_SETTINGS_ITEMS,
    activeId: settingsTab,
    onSelect: (id: string) => shellNav.setSettingsSection(id)
  }
  const settingsSidebarItems: PrimaryRailItem[] = [
    {
      id: 'settings-close',
      label: 'Back to app',
      icon: ArrowLeft,
      onSelect: onBack
    }
  ]
  const activeBg = settings.darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'
  const hoverBg = settings.darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'

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

      <ShellAdapterProvider value={desktopShellAdapter}>
        <UnifiedSidebar
          brand={
            <span className="flex items-baseline gap-[0.4em] font-serif text-[15px] text-(--foreground)">
              <OverlayMark size={8} className="translate-y-[0.1em]" />
              <span>overlay</span>
            </span>
          }
          collapsed={shellNav.collapsed}
          onCollapsedChange={shellNav.setCollapsed}
          items={settingsSidebarItems}
          panelKind="settings"
          panelNav={settingsPanelNav}
          scope={shellNav.scope}
          settingsGroups={DESKTOP_SETTINGS_GROUPS}
          account={
            <DesktopWorkspaceSwitcher
              onOpenAccount={() => shellNav.setSettingsSection('account')}
              onOpenSettings={() => shellNav.setSettingsSection('general')}
              onSignOut={onSignOut}
            />
          }
          keyboardShortcut
          resizable
          className="desktop-shell-controls h-full shrink-0"
        />
      </ShellAdapterProvider>

      <style>{`
        .desktop-shell-controls button,
        .desktop-shell-controls a,
        .desktop-shell-controls input {
          -webkit-app-region: no-drag;
        }
        @keyframes settingsFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

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
            {settingsTab === 'workspace' && <WorkspaceSettings theme={theme} />}
            {settingsTab === 'account' && <AccountSettings theme={theme} onSignOut={onSignOut} />}
          </div>
        </div>
      </div>
    </div>
  )
}
