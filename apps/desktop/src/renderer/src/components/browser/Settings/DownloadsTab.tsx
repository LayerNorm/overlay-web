import { ReactElement } from 'react'
import { DownloadInfo, Theme } from '../types'

interface DownloadsTabProps {
  downloads: DownloadInfo[]
  theme: Theme
}

export function DownloadsTab({ downloads, theme }: DownloadsTabProps): ReactElement {
  return (
    <div style={{ maxWidth: 600 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: theme.text,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
          }}
        >
          Downloads
        </h2>
        <button
          onClick={() => window.bridge.browser.openDownloadsFolder()}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: theme.surface,
            color: theme.text,
            fontSize: 13,
            cursor: 'pointer'
          }}
        >
          Open Folder
        </button>
      </div>
      {downloads.length === 0 ? (
        <div
          style={{
            color: theme.textSecondary,
            fontSize: 14,
            textAlign: 'center',
            padding: 40,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
          }}
        >
          No downloads yet
        </div>
      ) : (
        downloads.map((dl) => (
          <div key={dl.id} style={{ padding: '12px 0' }}>
            <div
              style={{
                fontSize: 14,
                color: theme.text,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
              }}
            >
              {dl.filename}
            </div>
            <div
              style={{
                fontSize: 12,
                color: theme.textSecondary,
                marginTop: 4,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
              }}
            >
              {dl.state}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
