'use client'

import { useState, useEffect, useCallback, useRef, type UIEvent } from 'react'
import Image from 'next/image'
import { Loader2, X, Search } from 'lucide-react'
import {
  resolveIntegrationName,
  truncateIntegrationDescription,
  type IntegrationProviderCapabilities,
} from '@overlay/app-core'
import { useDialogFocus, usePresence } from '@overlay/ui'
import { IntegrationDialogRowSkeleton } from '@overlay/ui/feedback'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

interface PickerItem {
  slug: string
  name: string
  description: string
  logoUrl: string | null
  isConnected: boolean
  capabilities: IntegrationProviderCapabilities
}

const SEARCH_DEBOUNCE_MS = 300

const DEFAULT_OVERLAY_CLASS =
  'fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-5'

export function IntegrationsDialog({
  connectedSlugs,
  isOpen,
  onClose,
  onConnect,
  onDisconnect,
  overlayClassName = DEFAULT_OVERLAY_CLASS,
}: {
  connectedSlugs: ReadonlySet<string>
  isOpen: boolean
  onClose: () => void
  onConnect: (slug: string) => Promise<void>
  onDisconnect: (slug: string) => Promise<void>
  /** Root overlay (e.g. higher z-index when opened from another modal). */
  overlayClassName?: string
}) {
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<PickerItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingInitial, setLoadingInitial] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actingSlug, setActingSlug] = useState<string | null>(null)
  const requestSeqRef = useRef(0)
  const fetchingMoreRef = useRef(false)
  const defaultCacheRef = useRef<{ items: PickerItem[]; nextCursor: string | null } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [queryInput])

  const fetchPage = useCallback(async (fetchQuery: string, cursor?: string | null, append = false) => {
    const reqId = ++requestSeqRef.current
    if (append) {
      if (fetchingMoreRef.current) return
      fetchingMoreRef.current = true
      setLoadingMore(true)
    } else {
      setLoadingInitial(true)
      setError(null)
      if (fetchQuery) { setItems([]); setNextCursor(null) }
    }

    try {
      const res = await overlayAppClient.integrations.getResponse({
        action: 'search',
        limit: 12,
        q: fetchQuery || undefined,
        cursor: cursor || undefined,
      })
      if (reqId !== requestSeqRef.current) return
      if (!res.ok) {
          const failure = (await res.json().catch(() => null)) as {
            error?: string
            message?: string
          } | null
          throw new Error(
            failure?.message || failure?.error || 'Failed to load integrations',
          )
      }
      const data = await res.json()
        const pageItems = Array.isArray(data?.items)
          ? (data.items as PickerItem[])
          : []

      const resolve = (row: PickerItem[]) =>
        row.map((item) => ({
          ...item,
          name: resolveIntegrationName(item.slug, item.name),
        }))

      setItems((prev) => {
        const merged = append ? [...prev, ...resolve(pageItems)] : resolve(pageItems)
        const map = new Map<string, PickerItem>()
        for (const item of merged) map.set(item.slug, item)
        return [...map.values()]
      })
      setNextCursor(data.nextCursor ?? null)

      if (!fetchQuery) {
        const merged = append
          ? [...(defaultCacheRef.current?.items || []), ...resolve(pageItems)]
          : resolve(pageItems)
        const map = new Map<string, PickerItem>()
        for (const item of merged) map.set(item.slug, item)
        defaultCacheRef.current = { items: [...map.values()], nextCursor: data.nextCursor ?? null }
      }
    } catch (err) {
      if (reqId === requestSeqRef.current) setError(err instanceof Error ? err.message : 'Error loading integrations')
    } finally {
        if (append) {
          fetchingMoreRef.current = false
          // Append runs reset the paging guard instead of the initial spinner.
          // react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
          setLoadingMore(false)
        } else setLoadingInitial(false)
    }
  }, [])

  // Query state → fetch: this is the dialog's data flow, not an accidental chain.
  // react-doctor-disable-next-line react-doctor/no-effect-chain
  useEffect(() => {
    if (!isOpen) return
    if (!query && defaultCacheRef.current) {
      setItems(defaultCacheRef.current.items)
      setNextCursor(defaultCacheRef.current.nextCursor)
      return
    }
    void fetchPage(query)
  }, [isOpen, query, fetchPage])

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen)
    if (!isOpen) {
    setQueryInput('')
    setQuery('')
    setError(null)
    setActingSlug(null)
    if (defaultCacheRef.current) {
      setItems(defaultCacheRef.current.items)
      setNextCursor(defaultCacheRef.current.nextCursor)
    } else {
      setItems([])
    }
    }
  }

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const t = e.currentTarget
    if (t.scrollHeight - t.scrollTop - t.clientHeight <= 120 && nextCursor && !loadingMore && !fetchingMoreRef.current) {
      void fetchPage(query, nextCursor, true)
    }
  }, [nextCursor, loadingMore, query, fetchPage])

  const handleConnect = useCallback(async (slug: string) => {
    if (actingSlug) return
    setActingSlug(slug)
    setError(null)
    try {
      await onConnect(slug)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setActingSlug(null)
    }
  }, [actingSlug, onConnect])

  const handleDisconnect = useCallback(async (slug: string) => {
    if (actingSlug) return
    setActingSlug(slug)
    setError(null)
    try {
      await onDisconnect(slug)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setActingSlug(null)
    }
  }, [actingSlug, onDisconnect])

  const { mounted, visible } = usePresence(isOpen)
  const dialogRef = useDialogFocus(mounted)

  useEffect(() => {
    if (!mounted) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mounted, onClose])
  if (!mounted) return null

  const isSearching = queryInput.trim() !== query || loadingInitial
  const visibleItems = isSearching
    ? []
    : items.map((item) => ({ ...item, isConnected: connectedSlugs.has(item.slug) }))

  return (
    // Scrim click-to-dismiss is a pointer affordance; keyboard users dismiss via Escape or the close control.
    // react-doctor-disable-next-line react-doctor/no-static-element-interactions
    <div
      className={`${overlayClassName} transition-opacity duration-200 ease-[var(--overlay-ease)] ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Custom modal keeps enter/exit transitions; focus trapped via useDialogFocus. */}
      {/* react-doctor-disable-next-line react-doctor/prefer-html-dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="integrations-dialog-title"
        className={`flex max-h-[80vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl transition-[opacity,transform] duration-200 ease-[var(--overlay-ease)] ${
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-1'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <p id="integrations-dialog-title" className='text-sm font-semibold text-[var(--foreground)]'>
              Add Integration
            </p>
            <p className='mt-0.5 text-xs text-[var(--muted)]'>
              Search integrations available from the configured provider
            </p>
          </div>
          <button
            type='button'
            aria-label="Close"
            onClick={onClose}
            className='rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-[var(--border)] px-5 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2">
            <Search size={13} className="shrink-0 text-[var(--muted-light)]" />
            <input
              type="text"
              aria-label="Search integrations"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search integrations..."
              data-autofocus
              className="flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
          {error && (
            <div className='mx-4 my-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--foreground)]'>
              {error}
            </div>
          )}
          {isSearching && <IntegrationDialogRowSkeleton rows={8} />}
          {!isSearching && visibleItems.length === 0 && (
            <div className='py-10 text-center text-xs text-[var(--muted)]'>
              No integrations found.
            </div>
          )}
          {visibleItems.map((item) => {
            const isActing = actingSlug === item.slug
            const disconnectUnavailable = item.isConnected && item.capabilities.supportsDisconnect === false
            const actionLabel = item.isConnected
              ? disconnectUnavailable ? 'Managed externally' : 'Disconnect'
              : item.capabilities.connectionSetup === 'provider-console' ? 'Configure' : 'Connect'
            return (
              <div
                key={item.slug}
                className='flex items-center gap-3 border-b border-[var(--border)] px-5 py-3 last:border-0'
              >
                <span
                  className="inline-flex flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]"
                  style={{ width: 32, height: 32 }}
                >
                  {item.logoUrl ? (
                    <Image
                      src={item.logoUrl}
                      alt={item.name}
                      width={20}
                      height={20}
                      unoptimized
                      className="object-contain"
                    />
                  ) : (
                    <span className='text-sm font-bold text-[var(--foreground)]'>
                      {item.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className='text-xs font-medium text-[var(--foreground)]'>
                    {item.name}
                  </p>
                  <p className='truncate text-xs text-[var(--muted)]'>
                    {truncateIntegrationDescription(
                      item.description || item.slug,
                    )}
                  </p>
                </div>
                {item.isConnected ? (
                  <button
                    type="button"
                    onClick={() => void handleDisconnect(item.slug)}
                    disabled={isActing || disconnectUnavailable}
                    className="flex-shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
                  >
                    {isActing ? (
                      <Loader2 size={11} className='animate-spin' />
                    ) : (
                      actionLabel
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleConnect(item.slug)}
                    disabled={isActing}
                    className="flex-shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
                  >
                    {isActing ? (
                      <Loader2 size={11} className='animate-spin' />
                    ) : (
                      actionLabel
                    )}
                  </button>
                )}
              </div>
            )
          })}
          {loadingMore && (
            <div className="px-5 py-4" aria-hidden>
              <div className="ui-skeleton-line mx-auto h-2 w-32 rounded-full opacity-80" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
