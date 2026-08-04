import { ImageResponse } from 'next/og'
import { convex } from '@/server/database/convex'

export const alt = 'Shared file — Overlay'
export const contentType = 'image/png'
export const size = { width: 1200, height: 630 }

type SharedFile = {
  name: string
  kind: string
  mimeType: string | null
  extension: string | null
  sizeBytes: number | null
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function describe(file: SharedFile): string {
  const parts = [
    file.kind === 'note' ? 'Note' : file.extension?.toUpperCase() || file.mimeType || 'File',
    formatBytes(file.sizeBytes),
  ].filter(Boolean)
  return parts.join(' · ')
}

export default async function OpengraphImage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const file = await convex.query<SharedFile | null>(
    'files/files:getPublicByToken',
    { token },
    { background: true },
  )
  const title = file?.name || 'Shared file'
  const subtitle = file ? describe(file) : ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background:
            'linear-gradient(135deg, #0a0a0a 0%, #111418 50%, #0a0a0a 100%)',
          color: 'white',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'white',
              color: '#0a0a0a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            o
          </div>
          <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: -0.5 }}>
            overlay
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 600,
              lineHeight: 1.1,
              letterSpacing: -1.5,
              maxWidth: 1000,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 28, color: '#a1a1aa' }}>{subtitle}</div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 22,
            color: '#71717a',
          }}
        >
          <span>Shared file</span>
          <span>getoverlay.io</span>
        </div>
      </div>
    ),
    { ...size },
  )
}
