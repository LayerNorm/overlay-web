import { ReactElement } from 'react'
import { Star, Clock, Download, Bookmark, Settings } from 'lucide-react'
import { Theme } from '../types'

interface ActionButtonsProps {
  isCurrentPageBookmarked: boolean
  showHistory: boolean
  showDownloads: boolean
  showBookmarks: boolean
  showSettings: boolean
  theme: Theme
  onAddBookmark: () => void
  onToggleHistory: () => void
  onToggleDownloads: () => void
  onToggleBookmarks: () => void
  onOpenSettings: () => void
}

export function ActionButtons({
  isCurrentPageBookmarked,
  showHistory,
  showDownloads,
  showBookmarks,
  showSettings,
  theme,
  onAddBookmark,
  onToggleHistory,
  onToggleDownloads,
  onToggleBookmarks,
  onOpenSettings
}: ActionButtonsProps): ReactElement<any> {
  return (
    <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={onAddBookmark}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title={isCurrentPageBookmarked ? 'Bookmarked' : 'Add bookmark'}
      >
        <Star
          size={16}
          color={isCurrentPageBookmarked ? '#f59e0b' : theme.textSecondary}
          fill={isCurrentPageBookmarked ? '#f59e0b' : 'none'}
        />
      </button>
      <button
        onClick={onToggleHistory}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: showHistory
            ? theme.isDark
              ? 'rgba(255, 255, 255, 0.15)'
              : 'rgba(0, 0, 0, 0.1)'
            : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title="History"
      >
        <Clock size={16} color={showHistory ? theme.text : theme.textSecondary} />
      </button>
      <button
        onClick={onToggleDownloads}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: showDownloads
            ? theme.isDark
              ? 'rgba(255, 255, 255, 0.15)'
              : 'rgba(0, 0, 0, 0.1)'
            : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title="Downloads"
      >
        <Download size={16} color={showDownloads ? theme.text : theme.textSecondary} />
      </button>
      <button
        onClick={onToggleBookmarks}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: showBookmarks
            ? theme.isDark
              ? 'rgba(255, 255, 255, 0.15)'
              : 'rgba(0, 0, 0, 0.1)'
            : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title="Bookmarks"
      >
        <Bookmark size={16} color={showBookmarks ? theme.text : theme.textSecondary} />
      </button>
      <button
        onClick={onOpenSettings}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: showSettings
            ? theme.isDark
              ? 'rgba(255, 255, 255, 0.15)'
              : 'rgba(0, 0, 0, 0.1)'
            : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title="Settings (⌘⇧/)"
      >
        <Settings size={16} color={showSettings ? theme.text : theme.textSecondary} />
      </button>
    </div>
  )
}
