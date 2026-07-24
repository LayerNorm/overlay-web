import type { ReactNode } from 'react'
import { ReactElement, RefObject } from 'react'
import { Theme } from '../types'
import { NavigationButtons } from './NavigationButtons'
import { UrlBar } from './UrlBar'
import { ActionButtons } from './ActionButtons'

interface ToolbarProps {
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  inputUrl: string
  isUrlFocused: boolean
  isCurrentPageBookmarked: boolean
  showHistory: boolean
  showDownloads: boolean
  showBookmarks: boolean
  showSettings: boolean
  theme: Theme
  urlInputRef: RefObject<HTMLInputElement | null>
  headerLeftSlot?: ReactNode
  onGoBack: () => void
  onGoForward: () => void
  onReload: () => void
  onUrlChange: (url: string) => void
  onUrlSubmit: (e: React.FormEvent) => void
  onUrlFocus: (e: React.FocusEvent<HTMLInputElement>) => void
  onUrlBlur: () => void
  onUrlKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onAddBookmark: () => void
  onToggleHistory: () => void
  onToggleDownloads: () => void
  onToggleBookmarks: () => void
  onOpenSettings: () => void
}

export function Toolbar({
  canGoBack,
  canGoForward,
  isLoading,
  inputUrl,
  isUrlFocused,
  isCurrentPageBookmarked,
  showHistory,
  showDownloads,
  showBookmarks,
  showSettings,
  theme,
  urlInputRef,
  headerLeftSlot,
  onGoBack,
  onGoForward,
  onReload,
  onUrlChange,
  onUrlSubmit,
  onUrlFocus,
  onUrlBlur,
  onUrlKeyDown,
  onAddBookmark,
  onToggleHistory,
  onToggleDownloads,
  onToggleBookmarks,
  onOpenSettings
}: ToolbarProps): ReactElement {
  return (
    <div
      style={
        {
          display: 'flex',
          alignItems: 'center',
          height: '44px',
          gap: 8,
          padding: '0 12px',
          background: theme.background,
          borderBottom: `1px solid ${theme.border}`,
          borderRadius: '8px 8px 0 0',
          WebkitAppRegion: 'drag',
          flexShrink: 0
        } as React.CSSProperties
      }
    >
      {headerLeftSlot}
      <NavigationButtons
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isLoading={isLoading}
        theme={theme}
        onGoBack={onGoBack}
        onGoForward={onGoForward}
        onReload={onReload}
      />

      <UrlBar
        inputUrl={inputUrl}
        isUrlFocused={isUrlFocused}
        theme={theme}
        urlInputRef={urlInputRef}
        onUrlChange={onUrlChange}
        onUrlSubmit={onUrlSubmit}
        onUrlFocus={onUrlFocus}
        onUrlBlur={onUrlBlur}
        onUrlKeyDown={onUrlKeyDown}
      />

      <ActionButtons
        isCurrentPageBookmarked={isCurrentPageBookmarked}
        showHistory={showHistory}
        showDownloads={showDownloads}
        showBookmarks={showBookmarks}
        showSettings={showSettings}
        theme={theme}
        onAddBookmark={onAddBookmark}
        onToggleHistory={onToggleHistory}
        onToggleDownloads={onToggleDownloads}
        onToggleBookmarks={onToggleBookmarks}
        onOpenSettings={onOpenSettings}
      />
    </div>
  )
}
