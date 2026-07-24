'use client'

import type {
ConnectorCatalogItem
} from '@overlay/app-core'
import {
Loader2,
Plus,
Search
} from 'lucide-react'
import { useState,type ReactNode } from 'react'
import { AppScreenBody, AppScreenHeader } from '../shell'

export interface ExtensionPageHeaderProps {
  title: string
  searchOpen: boolean
  searchQuery: string
  searchPlaceholder: string
  searchTitle: string
  action?: ReactNode
  onSearchOpenChange: (open: boolean) => void
  onSearchQueryChange: (query: string) => void
}

export function ExtensionPageHeader({
  title,
  searchOpen,
  searchQuery,
  searchPlaceholder,
  searchTitle,
  action,
  onSearchOpenChange,
  onSearchQueryChange,
}: ExtensionPageHeaderProps) {
  return (
    <AppScreenHeader className="px-3 py-2.5 sm:px-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <div className="shrink-0">
          <h1 className="text-sm font-medium text-[var(--foreground)]">{title}</h1>
        </div>
        {searchOpen ? (
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)] focus:border-[var(--muted)] max-sm:order-3 max-sm:w-full max-sm:flex-none"
          />
        ) : (
          <div className="flex-1" />
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            title={searchTitle}
            onClick={() => {
              onSearchOpenChange(!searchOpen)
              if (searchOpen) onSearchQueryChange('')
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
              searchOpen ? 'border-[var(--muted)] bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''
            }`}
          >
            <Search size={14} strokeWidth={1.75} />
          </button>
          {action}
        </div>
      </div>
    </AppScreenHeader>
  )
}

export interface IntegrationLogoProps {
  logoUrl?: string | null
  name: string
  size?: number
}

export function IntegrationLogo({ logoUrl, name, size = 28 }: IntegrationLogoProps) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  const hasError = !logoUrl || failedLogoUrl === logoUrl

  return (
    <span
      className="inline-flex flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]"
      style={{ width: size, height: size }}
    >
      {logoUrl && !hasError ? (
        <img
          src={logoUrl}
          alt={name}
          width={size - 10}
          height={size - 10}
          className="object-contain"
          onError={() => setFailedLogoUrl(logoUrl)}
        />
      ) : (
        <span className="text-xs font-bold text-[var(--foreground)]">{name.charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}

export interface IntegrationsPanelProps {
  loading: boolean
  loadingFallback: ReactNode
  connectedRows: readonly ConnectorCatalogItem[]
  availableRows: readonly ConnectorCatalogItem[]
  connectedVisible: number
  availableVisible: number
  connectingSlug?: string | null
  error?: string | null
  logoUrls?: Readonly<Record<string, string | null>>
  onClearError: () => void
  onConnectToggle: (integration: ConnectorCatalogItem) => void
  onShowMoreConnected: () => void
  onShowMoreAvailable: () => void
  onOpenCatalog: () => void
}

export function IntegrationsPanel({
  loading,
  loadingFallback,
  connectedRows,
  availableRows,
  connectedVisible,
  availableVisible,
  connectingSlug,
  error,
  logoUrls,
  onClearError,
  onConnectToggle,
  onShowMoreConnected,
  onShowMoreAvailable,
  onOpenCatalog,
}: IntegrationsPanelProps) {
  const connectedShown = connectedRows.slice(0, connectedVisible)
  const availableShown = availableRows.slice(0, availableVisible)

  return (
    <AppScreenBody padding="none" maxWidth="none" className="h-full">
      {loading ? (
        loadingFallback
      ) : (
        <div className="mx-auto max-w-2xl space-y-8 px-6 py-6">
          {error ? (
            <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <span>{error}</span>
              <button onClick={onClearError} className="ml-2 text-red-400 hover:text-red-300">✕</button>
            </div>
          ) : null}

          {connectedRows.length > 0 ? (
            <div>
              <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-light)]">Connected</p>
              <div className="space-y-1">
                {connectedShown.map((integration) => (
                  <IntegrationRow
                    key={integration.providerKey}
                    integration={integration}
                    logoUrl={logoUrls?.[integration.providerKey] ?? integration.logoUrl}
                    isConnected
                    isConnecting={connectingSlug === integration.providerKey}
                    onAction={onConnectToggle}
                  />
                ))}
              </div>
              {connectedVisible < connectedRows.length ? (
                <ShowMoreButton onClick={onShowMoreConnected} />
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-light)]">Available</p>
              <button
                type="button"
                onClick={onOpenCatalog}
                className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
                title="Browse all integrations"
              >
                <Plus size={12} />
                Add
              </button>
            </div>
            <div className="space-y-1">
              {availableShown.map((integration) => (
                <IntegrationRow
                  key={integration.providerKey}
                  integration={integration}
                  logoUrl={logoUrls?.[integration.providerKey] ?? integration.logoUrl}
                  isConnected={false}
                  isConnecting={connectingSlug === integration.providerKey}
                  onAction={onConnectToggle}
                />
              ))}
            </div>
            {availableVisible < availableRows.length ? (
              <ShowMoreButton onClick={onShowMoreAvailable} />
            ) : null}
          </div>
        </div>
      )}
    </AppScreenBody>
  )
}

function ShowMoreButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
    >
      Show more
    </button>
  )
}

function IntegrationRow({
  integration,
  logoUrl,
  isConnected,
  isConnecting,
  onAction,
}: {
  integration: ConnectorCatalogItem
  logoUrl?: string | null
  isConnected: boolean
  isConnecting: boolean
  onAction: (integration: ConnectorCatalogItem) => void
}) {
  const actionUnavailable = isConnected && integration.capabilities?.supportsDisconnect === false
  const actionLabel = isConnected
    ? actionUnavailable ? 'Managed externally' : 'Disconnect'
    : integration.capabilities?.connectionSetup === 'provider-console' ? 'Configure' : 'Connect'
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-3 transition-colors hover:bg-[var(--surface-muted)]">
      <div className="flex min-w-0 items-center gap-3">
        <IntegrationLogo logoUrl={logoUrl} name={integration.name} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[var(--foreground)]">{integration.name}</p>
          </div>
          <p className="truncate text-xs text-[var(--muted)]">{integration.description}</p>
        </div>
      </div>
      <button
        onClick={() => onAction(integration)}
        disabled={isConnecting || actionUnavailable}
        className="ml-4 flex-shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
      >
        {isConnecting ? (
          <Loader2 size={11} className="animate-spin" />
        ) : actionLabel}
      </button>
    </div>
  )
}
