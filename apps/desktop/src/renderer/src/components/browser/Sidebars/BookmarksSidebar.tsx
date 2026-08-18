import { ReactElement } from 'react'
import { X, Star } from 'lucide-react'
import { BookmarkEntry, Theme } from '../types'

interface BookmarksSidebarProps {
  bookmarks: BookmarkEntry[]
  theme: Theme
  onClose: () => void
  onOpenUrl: (url: string) => void
  onRemove: (id: string) => void
}

export function BookmarksSidebar({
  bookmarks,
  theme,
  onClose,
  onOpenUrl,
  onRemove
}: BookmarksSidebarProps): ReactElement<any> {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 280,
        background: theme.background,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        zIndex: 50,
        animation: 'slideInRight 0.15s ease-out'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px'
        }}
      >
        <span style={{ fontWeight: 600, color: theme.text, fontSize: 13 }}>Bookmarks</span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <X size={14} color={theme.textSecondary} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {bookmarks.map((bookmark) => (
          <div
            key={bookmark.id}
            style={{
              padding: '10px 24px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10
            }}
            onClick={() => onOpenUrl(bookmark.url)}
          >
            <Star size={14} color="#f59e0b" fill="#f59e0b" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: theme.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {bookmark.title}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: theme.textSecondary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {bookmark.url}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(bookmark.id)
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 4,
                cursor: 'pointer',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.5
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.5'
              }}
            >
              <X size={12} color={theme.textSecondary} />
            </button>
          </div>
        ))}
        {bookmarks.length === 0 && (
          <div
            style={{
              padding: 16,
              color: theme.textSecondary,
              textAlign: 'center',
              fontSize: 13
            }}
          >
            No bookmarks yet
          </div>
        )}
      </div>
    </div>
  )
}
