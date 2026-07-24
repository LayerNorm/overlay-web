import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  getAvailableConnectorRows,
  getConnectedConnectorRows,
  type ConnectedIntegrationsResponse,
  type ConnectorCatalogItem,
  type IntegrationConnectionResponse
} from '@overlay/app-core'
import { Theme } from '../../utils/theme'
import { SettingsRow } from '../ui/SettingsRow'
import { IntegrationsDialog } from './IntegrationsDialog'
import { desktopAppJson } from '../../services/app-api-client'
import {
  fetchDesktopIntegrations,
  getCachedDesktopIntegrations,
  subscribeDesktopIntegrations,
  type DesktopIntegrationsSnapshot
} from '../../services/integrations-cache'

interface IntegrationsSettingsProps {
  theme: Theme
  searchQuery?: string
}

const DESCRIPTION_MAX_CHARS = 84

function truncateDescription(description: string): string {
  const compact = description.replace(/\s+/g, ' ').trim()
  if (compact.length <= DESCRIPTION_MAX_CHARS) return compact
  return `${compact.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd()}...`
}

function IntegrationIcon({
  logoUrl,
  name
}: {
  logoUrl?: string | null
  name: string
}): ReactElement {
  const [hasLoadError, setHasLoadError] = useState(false)

  useEffect(() => setHasLoadError(false), [logoUrl])

  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        background: '#ffffff',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      {logoUrl && !hasLoadError ? (
        <img
          src={logoUrl}
          alt=""
          width={16}
          height={16}
          style={{ objectFit: 'contain' }}
          onError={() => setHasLoadError(true)}
        />
      ) : (
        <span style={{ fontSize: 10, fontWeight: 700, color: '#111' }}>
          {name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  )
}

function matchesQuery(item: ConnectorCatalogItem, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [item.name, item.description, item.slug, item.providerKey]
    .join(' ')
    .toLowerCase()
    .includes(normalized)
}

export function IntegrationsSettings({
  theme,
  searchQuery = ''
}: IntegrationsSettingsProps): ReactElement {
  const initialSnapshot = getCachedDesktopIntegrations()
  const [snapshot, setSnapshot] = useState<DesktopIntegrationsSnapshot | null>(initialSnapshot)
  const [error, setError] = useState<string | null>(null)
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const refresh = useCallback(
    async (force = false): Promise<DesktopIntegrationsSnapshot | null> => {
      try {
        const next = await fetchDesktopIntegrations({ force })
        setSnapshot(next)
        setError(null)
        return next
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load integrations')
        return null
      }
    },
    []
  )

  useEffect(() => {
    const unsubscribe = subscribeDesktopIntegrations(setSnapshot)
    void refresh(false)
    return unsubscribe
  }, [refresh])

  useEffect(() => {
    const refreshOnChange = (): void => {
      void refresh(true)
    }
    window.addEventListener('focus', refreshOnChange)
    window.addEventListener('overlay:integrations-changed', refreshOnChange)
    return () => {
      window.removeEventListener('focus', refreshOnChange)
      window.removeEventListener('overlay:integrations-changed', refreshOnChange)
    }
  }, [refresh])

  const connectToolkitViaOAuth = useCallback(
    async (
      toolkit: string,
      _source: 'settings-row' | 'dialog'
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const connectResult = await desktopAppJson<IntegrationConnectionResponse>(
          '/api/v1/integrations',
          {
            method: 'POST',
            body: JSON.stringify({ action: 'connect', toolkit })
          }
        )

        if (connectResult.redirectUrl) {
          window.bridge.openExternal(connectResult.redirectUrl)
        } else if (connectResult.connectionId) {
          await refresh(true)
          return { success: true }
        } else {
          return { success: false, error: connectResult.error || 'No OAuth URL returned' }
        }

        for (let attempt = 0; attempt < 150; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
          const data = await desktopAppJson<ConnectedIntegrationsResponse>('/api/v1/integrations')
          const connected = new Set((data.connected ?? []).map((item) => item.toLowerCase()))
          if (connected.has(toolkit.toLowerCase())) {
            await refresh(true)
            return { success: true }
          }
        }

        return { success: false, error: `Connection timed out for ${toolkit}. Please try again.` }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Connection failed'
        }
      }
    },
    [refresh]
  )

  const disconnectToolkit = useCallback(
    async (
      toolkit: string,
      _source: 'settings-row' | 'dialog'
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        await desktopAppJson<IntegrationConnectionResponse>('/api/v1/integrations', {
          method: 'POST',
          body: JSON.stringify({ action: 'disconnect', toolkit })
        })
        await refresh(true)
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Disconnect failed'
        }
      }
    },
    [refresh]
  )

  const handleConnectToggle = useCallback(
    async (integration: ConnectorCatalogItem): Promise<void> => {
      if (busySlug) return
      setBusySlug(integration.slug)
      setError(null)
      const connected =
        snapshot?.connected.has(integration.providerKey) ||
        snapshot?.connected.has(integration.slug)
      const result = connected
        ? await disconnectToolkit(integration.providerKey, 'settings-row')
        : await connectToolkitViaOAuth(integration.providerKey, 'settings-row')
      if (!result.success) setError(result.error || 'Integration update failed')
      setBusySlug(null)
    },
    [busySlug, connectToolkitViaOAuth, disconnectToolkit, snapshot?.connected]
  )

  const connectedRows = useMemo(
    () => getConnectedConnectorRows(snapshot?.connected ?? new Set(), snapshot?.catalog ?? []),
    [snapshot]
  )
  const availableRows = useMemo(
    // The provider catalog fetched for the + dialog is the only source for this list.
    () => getAvailableConnectorRows(snapshot?.connected ?? new Set(), snapshot?.catalog ?? [], []),
    [snapshot]
  )
  const connectedIntegrations = connectedRows.filter((item) => matchesQuery(item, searchQuery))
  const availableIntegrations = availableRows.filter((item) => matchesQuery(item, searchQuery))
  const hasNoResults =
    snapshot && connectedIntegrations.length === 0 && availableIntegrations.length === 0

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: theme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    margin: '12px 0 0',
    padding: '0 0 8px',
    borderBottom: `1px solid ${theme.border}`,
    fontFamily: 'system-ui, -apple-system, sans-serif'
  }

  const renderRow = (integration: ConnectorCatalogItem, connected: boolean): ReactElement => (
    <SettingsRow
      key={integration.slug}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IntegrationIcon logoUrl={integration.logoUrl} name={integration.name} />
          {integration.name}
        </span>
      }
      description={truncateDescription(integration.description || integration.slug)}
      theme={theme}
    >
      <div style={{ marginLeft: 28, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => void handleConnectToggle(integration)}
          disabled={busySlug === integration.slug}
          style={{
            padding: connected ? '6px 14px' : '8px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
            color: connected ? theme.textSecondary : theme.toggleThumb,
            background: connected ? 'transparent' : theme.buttonBg,
            border: 'none',
            cursor: busySlug === integration.slug ? 'not-allowed' : 'pointer',
            opacity: busySlug === integration.slug ? 0.6 : 1,
            textDecoration: connected ? 'underline' : 'none',
            textDecorationThickness: 2,
            textUnderlineOffset: 3
          }}
        >
          {busySlug === integration.slug
            ? connected
              ? 'Disconnecting...'
              : 'Connecting...'
            : connected
              ? 'Disconnect'
              : 'Connect'}
        </button>
      </div>
    </SettingsRow>
  )

  return (
    <div>
      {error ? (
        <div
          style={{
            padding: '8px 12px',
            marginTop: 8,
            borderRadius: 8,
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            color: theme.text,
            fontSize: 12
          }}
        >
          {error}
        </div>
      ) : null}

      {connectedIntegrations.length > 0 ? (
        <section style={{ marginBottom: 16 }}>
          <p style={sectionHeaderStyle}>Connected</p>
          {connectedIntegrations.map((item) => renderRow(item, true))}
        </section>
      ) : null}

      {snapshot ? (
        <section>
          <div
            style={{
              ...sectionHeaderStyle,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span>Available</span>
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                border: `1px solid ${theme.border}`,
                background: theme.surface,
                color: theme.text,
                fontSize: 18,
                lineHeight: '20px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0
              }}
              title="Add integration"
              aria-label="Add integration"
            >
              +
            </button>
          </div>
          {availableIntegrations.map((item) => renderRow(item, false))}
        </section>
      ) : (
        <div style={{ padding: '20px 0', color: theme.textSecondary, fontSize: 13 }}>
          Loading connectors...
        </div>
      )}

      {hasNoResults ? (
        <div
          style={{
            padding: '36px 16px',
            color: theme.textSecondary,
            fontSize: 13,
            textAlign: 'center'
          }}
        >
          No connectors match "{searchQuery.trim()}".
        </div>
      ) : null}

      <IntegrationsDialog
        isOpen={isPickerOpen}
        theme={theme}
        items={snapshot?.catalog ?? []}
        connectedSlugs={snapshot?.connected ?? new Set()}
        onClose={() => setIsPickerOpen(false)}
        onConnectToolkit={connectToolkitViaOAuth}
        onDisconnectToolkit={disconnectToolkit}
      />
    </div>
  )
}
