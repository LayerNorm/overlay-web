import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { ConnectorCatalogItem } from '@overlay/app-core'
import { Search, X } from 'lucide-react'
import { Theme } from '../../utils/theme'

interface IntegrationsDialogProps {
  isOpen: boolean
  theme: Theme
  items: readonly ConnectorCatalogItem[]
  connectedSlugs: ReadonlySet<string>
  onClose: () => void
  onConnectToolkit: (
    toolkit: string,
    source: 'dialog'
  ) => Promise<{ success: boolean; error?: string }>
  onDisconnectToolkit: (
    toolkit: string,
    source: 'dialog'
  ) => Promise<{ success: boolean; error?: string }>
}

function truncateDescription(description: string): string {
  const compact = description.replace(/\s+/g, ' ').trim()
  if (compact.length <= 84) return compact
  return `${compact.slice(0, 83).trimEnd()}...`
}

function IntegrationLogoTile({
  logoUrl,
  name
}: {
  logoUrl?: string | null
  name: string
}): ReactElement {
  const [hasError, setHasError] = useState(false)

  useEffect(() => setHasError(false), [logoUrl])

  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        background: '#ffffff',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      {logoUrl && !hasError ? (
        <img
          src={logoUrl}
          alt=""
          width={18}
          height={18}
          style={{ objectFit: 'contain' }}
          onError={() => setHasError(true)}
        />
      ) : (
        <span style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>
          {name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  )
}

export function IntegrationsDialog({
  isOpen,
  theme,
  items,
  connectedSlugs,
  onClose,
  onConnectToolkit,
  onDisconnectToolkit
}: IntegrationsDialogProps): ReactElement | null {
  const [query, setQuery] = useState('')
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setBusySlug(null)
      setError(null)
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return [...items]
      .filter((item) => {
        if (!normalized) return true
        return [item.name, item.description, item.slug, item.providerKey]
          .join(' ')
          .toLowerCase()
          .includes(normalized)
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [items, query])

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: theme.scrim,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add integration"
        style={{
          width: 'min(760px, 96vw)',
          maxHeight: '80vh',
          borderRadius: 12,
          background: theme.background,
          border: `1px solid ${theme.border}`,
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 14px',
            borderBottom: `1px solid ${theme.border}`
          }}
        >
          <Search size={15} color={theme.textSecondary} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search integrations..."
            aria-label="Search integrations"
            style={{
              minWidth: 0,
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: theme.text,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
            }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close integrations"
            style={{
              width: 28,
              height: 28,
              border: 'none',
              borderRadius: 7,
              background: 'transparent',
              color: theme.textSecondary,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ minHeight: 0, flex: 1, overflowY: 'auto' }}>
          {error ? (
            <div
              role="alert"
              style={{
                margin: '8px 14px',
                padding: '10px 12px',
                borderRadius: 8,
                border: `1px solid ${theme.border}`,
                background: theme.surface,
                color: theme.text,
                fontSize: 12
              }}
            >
              {error}
            </div>
          ) : null}

          {visibleItems.length === 0 ? (
            <div style={{ padding: '22px 14px', color: theme.textSecondary, fontSize: 13 }}>
              No integrations found.
            </div>
          ) : null}

          {visibleItems.map((item) => {
            const isConnected =
              connectedSlugs.has(item.providerKey) || connectedSlugs.has(item.slug)
            const isBusy = busySlug === item.slug
            return (
              <div
                key={item.slug}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderBottom: `1px solid ${theme.border}`
                }}
              >
                <IntegrationLogoTile logoUrl={item.logoUrl} name={item.name} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                    {truncateDescription(item.description || item.slug)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={Boolean(busySlug)}
                  onClick={async () => {
                    setBusySlug(item.slug)
                    setError(null)
                    const result = isConnected
                      ? await onDisconnectToolkit(item.providerKey, 'dialog')
                      : await onConnectToolkit(item.providerKey, 'dialog')
                    if (!result.success) setError(result.error || 'Integration update failed')
                    setBusySlug(null)
                  }}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: isConnected ? 'transparent' : theme.buttonBg,
                    color: isConnected ? theme.textSecondary : theme.toggleThumb,
                    fontSize: 12,
                    cursor: busySlug ? 'not-allowed' : 'pointer',
                    opacity: busySlug && !isBusy ? 0.5 : 1,
                    textDecoration: isConnected ? 'underline' : 'none',
                    textDecorationThickness: 2,
                    textUnderlineOffset: 3
                  }}
                >
                  {isBusy
                    ? isConnected
                      ? 'Disconnecting...'
                      : 'Connecting...'
                    : isConnected
                      ? 'Disconnect'
                      : 'Connect'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
