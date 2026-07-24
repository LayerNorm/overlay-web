import { ReactElement } from 'react'
import { Keyboard, Clock, Download, Bookmark, Cookie, Shield } from 'lucide-react'
import { Theme, SettingsTab } from '../types'

interface SettingsSidebarProps {
  activeTab: SettingsTab
  theme: Theme
  onSelectTab: (tab: SettingsTab) => void
}

const TABS: { key: SettingsTab; icon: typeof Keyboard }[] = [
  { key: 'shortcuts', icon: Keyboard },
  { key: 'history', icon: Clock },
  { key: 'downloads', icon: Download },
  { key: 'bookmarks', icon: Bookmark },
  { key: 'cookies', icon: Cookie },
  { key: 'permissions', icon: Shield }
]

export function SettingsSidebar({
  activeTab,
  theme,
  onSelectTab
}: SettingsSidebarProps): ReactElement {
  return (
    <div
      style={{
        width: 180,
        padding: '16px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        background: theme.background
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: theme.textSecondary,
          padding: '8px 12px',
          textTransform: 'uppercase',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
        }}
      >
        Settings
      </div>
      {TABS.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            onClick={() => onSelectTab(tab.key)}
            style={{
              padding: '10px 12px',
              borderRadius: 6,
              border: 'none',
              background:
                activeTab === tab.key
                  ? theme.isDark
                    ? 'rgba(255, 255, 255, 0.15)'
                    : 'rgba(0, 0, 0, 0.1)'
                  : 'transparent',
              color: activeTab === tab.key ? theme.text : theme.textSecondary,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              cursor: 'pointer',
              textAlign: 'left',
              textTransform: 'capitalize',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <Icon size={16} />
            {tab.key}
          </button>
        )
      })}
    </div>
  )
}
