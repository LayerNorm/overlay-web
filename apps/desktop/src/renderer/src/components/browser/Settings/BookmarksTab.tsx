import { ReactElement } from 'react'
import { Star } from 'lucide-react'
import { BookmarkEntry, Theme } from '../types'

interface BookmarksTabProps {
  bookmarks: BookmarkEntry[]
  theme: Theme
  onOpenUrl: (url: string) => void
}

export function BookmarksTab({ bookmarks, theme, onOpenUrl }: BookmarksTabProps): ReactElement<any> {
  return (
    <div style={{ maxWidth: 600 }}>
      <h2
        style={{
          margin: '0 0 24px',
          fontSize: 18,
          fontWeight: 600,
          color: theme.text,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
        }}
      >
        Bookmarks
      </h2>
      {bookmarks.length === 0 ? (
        <div
          style={{
            color: theme.textSecondary,
            fontSize: 14,
            textAlign: 'center',
            padding: 40,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
          }}
        >
          No bookmarks yet
        </div>
      ) : (
        bookmarks.map((bookmark) => (
          <div
            key={bookmark.id}
            onClick={() => onOpenUrl(bookmark.url)}
            style={{
              padding: '12px 0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 12
            }}
          >
            <Star size={16} color="#f59e0b" fill="#f59e0b" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  color: theme.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
                }}
              >
                {bookmark.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: theme.textSecondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: 4,
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
                }}
              >
                {bookmark.url}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
