export interface BrowserTab {
  id: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  favicon?: string
}

export interface DownloadInfo {
  id: string
  filename: string
  receivedBytes: number
  totalBytes: number
  state: string
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  visitTime: number
  favicon?: string
}

export interface BookmarkEntry {
  id: string
  url: string
  title: string
  createdAt: number
}

export interface CookieDomain {
  domain: string
  cookieCount: number
}

export interface CookieDetail {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
}

export interface SavedPermission {
  origin: string
  permissions: { permission: string; granted: boolean }[]
}

export interface SitePermission {
  permission: string
  granted: boolean
}

export type SiteInfoView = 'main' | 'cookies' | 'cookies-list' | 'permissions'

export type SettingsTab =
  | 'history'
  | 'downloads'
  | 'bookmarks'
  | 'shortcuts'
  | 'cookies'
  | 'permissions'

export type SidebarType = 'history' | 'downloads' | 'bookmarks' | 'siteinfo' | null

export interface Theme {
  background: string
  surface: string
  border: string
  selectionBg: string
  text: string
  textSecondary: string
  accent: string
  isDark: boolean
}
