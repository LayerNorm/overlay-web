'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Plus, RefreshCw, RotateCw, Trash2 } from 'lucide-react'
import type {
  WebhookDelivery,
  WebhookSubscription,
} from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  WEBHOOK_EVENT_TYPES,
  type WebhookEventType,
} from '@/shared/schemas/webhooks'

const EVENT_LABELS: Record<WebhookEventType, string> = {
  'automation.failed': 'Automation failed',
  'automation.finished': 'Automation finished',
  'chat.completed': 'Chat completed',
  'chat.failed': 'Chat failed',
}

export function WebhookSettings() {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [events, setEvents] = useState<WebhookEventType[]>(['automation.finished'])
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [loadedSubscriptions, loadedDeliveries] = await Promise.all([
      overlayAppClient.webhooks.list({ cache: 'no-store' }),
      overlayAppClient.webhooks.listDeliveries({}, { cache: 'no-store' }),
    ])
    setSubscriptions(loadedSubscriptions)
    setDeliveries(loadedDeliveries)
  }, [])

  useEffect(() => {
    void load().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load webhooks')
    })
  }, [load])

  async function mutate(action: () => Promise<Response>, onSuccess?: (response: Response) => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      const response = await action()
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || 'Webhook operation failed')
      }
      await onSuccess?.(response)
      await load()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Webhook operation failed')
    } finally {
      setBusy(false)
    }
  }

  async function createSubscription() {
    if (!url.trim() || events.length === 0) return
    await mutate(
      () => overlayAppClient.webhooks.createResponse({
        description: description.trim() || undefined,
        enabled: true,
        events,
        url: url.trim(),
      }),
      async (response) => {
        const payload = await overlayAppClient.webhooks.parseCreateResponse(response)
        setSelectedId(payload.id)
        setSecret(payload.secret)
        setUrl('')
        setDescription('')
      },
    )
  }

  function toggleEvent(event: WebhookEventType) {
    setEvents((current) => current.includes(event)
      ? current.filter((item) => item !== event)
      : [...current, event])
  }

  async function copySecret() {
    if (!secret) return
    await navigator.clipboard.writeText(secret)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-6">
      <section>
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Outbound webhooks</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Deliver signed chat and automation events to an HTTPS endpoint.
          </p>
        </div>
        <div className="grid gap-3 border-y border-[var(--border)] py-4 md:grid-cols-[1fr_1fr_auto]">
          <input
            aria-label="Webhook URL"
            className="h-9 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--muted)]"
            placeholder="https://example.com/overlay/events"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <input
            aria-label="Webhook description"
            className="h-9 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--muted)]"
            placeholder="Production event receiver"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--foreground)] px-3 text-sm font-medium text-[var(--background)] disabled:opacity-50"
            disabled={busy || !url.trim() || events.length === 0}
            onClick={() => void createSubscription()}
          >
            <Plus size={15} /> Add
          </button>
          <div className="flex flex-wrap gap-x-4 gap-y-2 md:col-span-3">
            {WEBHOOK_EVENT_TYPES.map((event) => (
              <label key={event} className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={events.includes(event)}
                  onChange={() => toggleEvent(event)}
                />
                {EVENT_LABELS[event]}
              </label>
            ))}
          </div>
        </div>
      </section>

      {secret ? (
        <section className="border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
          <h3 className="text-sm font-medium text-[var(--foreground)]">Signing secret</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Store this value now. It will not be shown again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-[var(--surface)] px-3 py-2 text-xs">{secret}</code>
            <button
              type="button"
              aria-label="Copy signing secret"
              className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--border)]"
              onClick={() => void copySecret()}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        </section>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Subscriptions</h3>
          <button
            type="button"
            aria-label="Refresh webhooks"
            className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] disabled:opacity-50"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {subscriptions.length === 0 ? (
            <p className="py-6 text-sm text-[var(--muted)]">No webhook subscriptions.</p>
          ) : subscriptions.map((subscription) => (
            <div key={subscription._id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => setSelectedId((current) => current === subscription._id ? null : subscription._id)}
                >
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">
                    {subscription.description || subscription.url}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">{subscription.url}</p>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => void mutate(() => overlayAppClient.webhooks.updateResponse({
                      enabled: !subscription.enabled,
                      subscriptionId: subscription._id,
                    }))}
                  >
                    {subscription.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    aria-label="Rotate signing secret"
                    className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)]"
                    disabled={busy}
                    onClick={() => void mutate(
                      () => overlayAppClient.webhooks.rotateSecretResponse(subscription._id),
                      async (response) => setSecret(
                        (await overlayAppClient.webhooks.parseRotateSecretResponse(response)).secret,
                      ),
                    )}
                  >
                    <RotateCw size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete webhook"
                    className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] text-red-600 dark:text-red-400"
                    disabled={busy}
                    onClick={() => void mutate(() => overlayAppClient.webhooks.deleteResponse(subscription._id))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {subscription.events.map((event) => EVENT_LABELS[event]).join(', ')}
              </p>
              {selectedId === subscription._id ? (
                <DeliveryHistory
                  busy={busy}
                  deliveries={deliveries.filter((delivery) => delivery.subscriptionId === subscription._id)}
                  onRedrive={(deliveryId) => void mutate(
                    () => overlayAppClient.webhooks.redriveResponse(deliveryId),
                  )}
                />
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function DeliveryHistory({
  busy,
  deliveries,
  onRedrive,
}: {
  busy: boolean
  deliveries: WebhookDelivery[]
  onRedrive: (deliveryId: string) => void
}) {
  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <p className="mb-2 text-xs font-medium text-[var(--foreground)]">Recent deliveries</p>
      {deliveries.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">No deliveries yet.</p>
      ) : (
        <div className="space-y-2">
          {deliveries.slice(0, 20).map((delivery) => (
            <div key={delivery._id} className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <p className="truncate text-[var(--foreground)]">{delivery.eventType}</p>
                <p className="text-[var(--muted)]">
                  {delivery.status.replace('_', ' ')} · {delivery.attemptCount} attempt{delivery.attemptCount === 1 ? '' : 's'}
                  {delivery.lastStatusCode ? ` · HTTP ${delivery.lastStatusCode}` : ''}
                </p>
              </div>
              {delivery.status === 'dead_letter' ? (
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1.5"
                  disabled={busy}
                  onClick={() => onRedrive(delivery._id)}
                >
                  Redrive
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
