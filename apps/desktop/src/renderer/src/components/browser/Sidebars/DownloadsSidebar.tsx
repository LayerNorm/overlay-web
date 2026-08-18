import { ReactElement } from 'react'
import { X } from 'lucide-react'
import { DownloadInfo, Theme } from '../types'

interface DownloadsSidebarProps {
  downloads: DownloadInfo[]
  theme: Theme
  onClose: () => void
}

export function DownloadsSidebar({
  downloads,
  theme,
  onClose
}: DownloadsSidebarProps): ReactElement<any> {
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
        <span style={{ fontWeight: 600, color: theme.text, fontSize: 13 }}>Downloads</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => window.bridge.browser.openDownloadsFolder()}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: 'none',
              background: theme.background,
              color: theme.textSecondary,
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            Open Folder
          </button>
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
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {downloads.map((dl) => (
          <div
            key={dl.id}
            style={{
              padding: '10px 24px'
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: theme.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {dl.filename}
            </div>
            <div style={{ marginTop: 4 }}>
              <div
                style={{
                  height: 4,
                  background: theme.border,
                  borderRadius: 2,
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${dl.totalBytes > 0 ? (dl.receivedBytes / dl.totalBytes) * 100 : 0}%`,
                    background: theme.accent,
                    borderRadius: 2
                  }}
                />
              </div>
            </div>
            <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 4 }}>
              {dl.state === 'completed'
                ? 'Completed'
                : dl.state === 'cancelled'
                  ? 'Cancelled'
                  : `${Math.round((dl.receivedBytes / 1024 / 1024) * 10) / 10} MB / ${Math.round((dl.totalBytes / 1024 / 1024) * 10) / 10} MB`}
            </div>
          </div>
        ))}
        {downloads.length === 0 && (
          <div
            style={{
              padding: 16,
              color: theme.textSecondary,
              textAlign: 'center',
              fontSize: 13
            }}
          >
            No downloads yet
          </div>
        )}
      </div>
    </div>
  )
}
