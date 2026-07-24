import { ReactElement } from 'react'
import {
  Theme,
  SettingsTab,
  HistoryEntry,
  DownloadInfo,
  BookmarkEntry,
  CookieDomain,
  SavedPermission,
  CookieDetail
} from '../types'
import { SettingsSidebar } from './SettingsSidebar'
import { ShortcutsTab } from './ShortcutsTab'
import { HistoryTab } from './HistoryTab'
import { DownloadsTab } from './DownloadsTab'
import { BookmarksTab } from './BookmarksTab'
import { CookiesTab } from './CookiesTab'
import { PermissionsTab } from './PermissionsTab'

interface SettingsPanelProps {
  settingsTab: SettingsTab
  theme: Theme
  history: HistoryEntry[]
  downloads: DownloadInfo[]
  bookmarks: BookmarkEntry[]
  allCookieDomains: CookieDomain[]
  expandedCookieDomain: string | null
  domainCookies: CookieDetail[]
  savedPermissions: SavedPermission[]
  expandedPermissionOrigin: string | null
  onSetSettingsTab: (tab: SettingsTab) => void
  onClearHistory: () => void
  onOpenHistoryUrl: (url: string) => void
  onOpenBookmarkUrl: (url: string) => void
  onLoadAllCookies: () => void
  onExpandCookieDomain: (domain: string | null) => void
  onLoadDomainCookies: (domain: string) => Promise<CookieDetail[]>
  onDeleteCookiesForDomain: (domain: string) => void
  onLoadPermissions: () => void
  onExpandPermissionOrigin: (origin: string | null) => void
  onDeletePermissionsForOrigin: (origin: string) => void
  onDeletePermission: (origin: string, permission: string) => void
}

export function SettingsPanel({
  settingsTab,
  theme,
  history,
  downloads,
  bookmarks,
  allCookieDomains,
  expandedCookieDomain,
  domainCookies,
  savedPermissions,
  expandedPermissionOrigin,
  onSetSettingsTab,
  onClearHistory,
  onOpenHistoryUrl,
  onOpenBookmarkUrl,
  onLoadAllCookies,
  onExpandCookieDomain,
  onLoadDomainCookies,
  onDeleteCookiesForDomain,
  onLoadPermissions,
  onExpandPermissionOrigin,
  onDeletePermissionsForOrigin,
  onDeletePermission
}: SettingsPanelProps): ReactElement {
  return (
    <div
      style={{
        flex: 1,
        background: theme.background,
        display: 'flex',
        overflow: 'hidden',
        borderRadius: '8px 8px 0 0'
      }}
    >
      <SettingsSidebar activeTab={settingsTab} theme={theme} onSelectTab={onSetSettingsTab} />

      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {settingsTab === 'shortcuts' && <ShortcutsTab theme={theme} />}

        {settingsTab === 'history' && (
          <HistoryTab
            history={history}
            theme={theme}
            onClear={onClearHistory}
            onOpenUrl={onOpenHistoryUrl}
          />
        )}

        {settingsTab === 'downloads' && <DownloadsTab downloads={downloads} theme={theme} />}

        {settingsTab === 'bookmarks' && (
          <BookmarksTab bookmarks={bookmarks} theme={theme} onOpenUrl={onOpenBookmarkUrl} />
        )}

        {settingsTab === 'cookies' && (
          <CookiesTab
            allCookieDomains={allCookieDomains}
            expandedCookieDomain={expandedCookieDomain}
            domainCookies={domainCookies}
            theme={theme}
            onLoadAll={onLoadAllCookies}
            onExpandDomain={onExpandCookieDomain}
            onLoadDomainCookies={onLoadDomainCookies}
            onDeleteForDomain={onDeleteCookiesForDomain}
          />
        )}

        {settingsTab === 'permissions' && (
          <PermissionsTab
            savedPermissions={savedPermissions}
            expandedOrigin={expandedPermissionOrigin}
            theme={theme}
            onLoad={onLoadPermissions}
            onExpandOrigin={onExpandPermissionOrigin}
            onDeleteForOrigin={onDeletePermissionsForOrigin}
            onDeletePermission={onDeletePermission}
          />
        )}
      </div>
    </div>
  )
}
