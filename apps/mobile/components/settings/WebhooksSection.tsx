import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Feather } from '@expo/vector-icons'
import { borderRadius, fontSize, spacing, type Theme } from '../../constants/theme'
import { BottomSheet } from '../ui/AppChrome'
import {
  WEBHOOK_EVENT_TYPES,
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  redriveWebhookDelivery,
  rotateWebhookSecret,
  updateWebhookSubscription,
  type WebhookDelivery,
  type WebhookSubscription,
} from '../../services/webhooksService'
import { ActionRow, SettingsSection, settingsStyles } from './primitives'

/**
 * Webhooks settings section — parity of web `WebhookSettings`: subscription
 * CRUD, per-subscription deliveries with redrive, and secret rotation. The
 * signing secret is shown exactly once (at create and at rotate) — copy it
 * then; the server never returns it again.
 */

const STATUS_COLORS: Record<string, string> = {
  delivered: '#22C55E',
  delivering: '#3B82F6',
  pending: '#F59E0B',
  failed: '#EF4444',
  dead_letter: '#EF4444',
}

export function WebhooksSection({
  theme,
  workspaceId,
}: {
  theme: Theme
  workspaceId: string
}): React.ReactElement {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<WebhookSubscription | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSubscriptions(await listWebhookSubscriptions(workspaceId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Webhook list unavailable')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggleEnabled(subscription: WebhookSubscription, enabled: boolean): Promise<void> {
    try {
      await updateWebhookSubscription(workspaceId, { subscriptionId: subscription._id, enabled })
      await refresh()
    } catch (err) {
      Alert.alert(
        'Could not update subscription',
        err instanceof Error ? err.message : 'Try again.',
      )
    }
  }

  return (
    <>
      <SettingsSection
        theme={theme}
        title="Webhooks"
        icon="rss"
        accessory={
          <TouchableOpacity onPress={() => setAddOpen(true)} hitSlop={8}>
            <Feather name="plus" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        }
      >
        {loading && subscriptions === null ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : error ? (
          <Text style={[settingsStyles.helperText, { color: '#EF4444' }]}>{error}</Text>
        ) : (subscriptions ?? []).length === 0 ? (
          <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
            No webhook subscriptions. Overlay POSTs signed events to any HTTPS endpoint you add.
          </Text>
        ) : (
          (subscriptions ?? []).map((subscription) => (
            <TouchableOpacity
              key={subscription._id}
              activeOpacity={0.82}
              onPress={() => setDetail(subscription)}
              style={[settingsStyles.row, { borderColor: theme.border }]}
            >
              <View style={settingsStyles.rowCopy}>
                <Text style={[settingsStyles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                  {subscription.description?.trim() || subscription.url}
                </Text>
                <Text
                  style={[settingsStyles.rowDetail, { color: theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {subscription.events.join(', ')}
                </Text>
              </View>
              <Switch
                value={subscription.enabled}
                onValueChange={(next) => void toggleEnabled(subscription, next)}
              />
            </TouchableOpacity>
          ))
        )}
      </SettingsSection>

      {detail ? (
        <WebhookDetailSheet
          key={detail._id}
          theme={theme}
          workspaceId={workspaceId}
          subscription={detail}
          onClose={() => setDetail(null)}
          onChanged={() => {
            setDetail(null)
            void refresh()
          }}
        />
      ) : null}
      {addOpen ? (
        <AddWebhookSheet
          theme={theme}
          workspaceId={workspaceId}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false)
            void refresh()
          }}
        />
      ) : null}
    </>
  )
}

function WebhookDetailSheet({
  theme,
  workspaceId,
  subscription,
  onClose,
  onChanged,
}: {
  theme: Theme
  workspaceId: string
  subscription: WebhookSubscription
  onClose: () => void
  onChanged: () => void
}): React.ReactElement {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null)
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadDeliveries = useCallback(
    async (subscriptionId: string) => {
      try {
        setDeliveries(await listWebhookDeliveries(workspaceId, { subscriptionId, limit: 20 }))
        setDeliveriesError(null)
      } catch (err) {
        setDeliveriesError(err instanceof Error ? err.message : 'Deliveries unavailable')
      }
    },
    [workspaceId],
  )

  useEffect(() => {
    void loadDeliveries(subscription._id)
  }, [subscription._id, loadDeliveries])

  async function redrive(deliveryId: string): Promise<void> {
    setBusy(true)
    try {
      await redriveWebhookDelivery(workspaceId, deliveryId)
      await loadDeliveries(subscription._id)
    } catch (err) {
      Alert.alert('Could not redrive', err instanceof Error ? err.message : 'Try again.')
    } finally {
      setBusy(false)
    }
  }

  function rotateSecret(): void {
    Alert.alert(
      'Rotate signing secret',
      'The current secret stops working immediately. Copy the new one — it is shown only once.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          onPress: async () => {
            setBusy(true)
            try {
              const secret = await rotateWebhookSecret(workspaceId, subscription._id)
              Alert.alert('New signing secret', secret, [
                { text: 'Copy', onPress: () => void Clipboard.setStringAsync(secret) },
                { text: 'Done' },
              ])
            } catch (err) {
              Alert.alert('Could not rotate', err instanceof Error ? err.message : 'Try again.')
            } finally {
              setBusy(false)
            }
          },
        },
      ],
    )
  }

  function confirmDelete(): void {
    Alert.alert('Delete subscription', `Stop events to ${subscription.url}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteWebhookSubscription(workspaceId, subscription._id)
            onChanged()
          } catch (err) {
            Alert.alert('Could not delete', err instanceof Error ? err.message : 'Try again.')
          }
        },
      },
    ])
  }

  return (
    <BottomSheet
      theme={theme}
      visible
      onClose={onClose}
      title={subscription.description?.trim() || 'Webhook'}
    >
      <View style={localStyles.sheetBody}>
        <Text selectable style={[settingsStyles.helperText, { color: theme.text }]}>
          {subscription.url}
        </Text>
        <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
          Events: {subscription.events.join(', ')}
        </Text>
        <Text style={[settingsStyles.fieldLabel, { color: theme.textSecondary }]}>
          Recent deliveries
        </Text>
        {deliveries === null && !deliveriesError ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : deliveriesError ? (
          <Text style={[settingsStyles.helperText, { color: '#EF4444' }]}>{deliveriesError}</Text>
        ) : (deliveries ?? []).length === 0 ? (
          <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
            No deliveries yet.
          </Text>
        ) : (
          <ScrollView style={localStyles.deliveryList} nestedScrollEnabled>
            {(deliveries ?? []).map((delivery) => (
              <View key={delivery._id} style={[settingsStyles.row, { borderColor: theme.border }]}>
                <View
                  style={[
                    localStyles.statusDot,
                    { backgroundColor: STATUS_COLORS[delivery.status] ?? theme.textSecondary },
                  ]}
                />
                <View style={settingsStyles.rowCopy}>
                  <Text style={[settingsStyles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                    {delivery.eventType} · {delivery.status}
                  </Text>
                  <Text
                    style={[settingsStyles.rowDetail, { color: theme.textSecondary }]}
                    numberOfLines={2}
                  >
                    {new Date(delivery.createdAt).toLocaleString()}
                    {delivery.lastStatusCode ? ` · HTTP ${delivery.lastStatusCode}` : ''}
                    {delivery.lastError ? ` · ${delivery.lastError}` : ''}
                  </Text>
                </View>
                {delivery.status === 'dead_letter' || delivery.status === 'failed' ? (
                  <TouchableOpacity
                    onPress={() => void redrive(delivery._id)}
                    disabled={busy}
                    hitSlop={8}
                  >
                    <Feather name="rotate-cw" size={16} color={theme.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          </ScrollView>
        )}
        <View style={localStyles.buttonRow}>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={rotateSecret}
            disabled={busy}
            style={[
              localStyles.button,
              { backgroundColor: theme.surfaceSubtle, opacity: busy ? 0.5 : 1 },
            ]}
          >
            <Text style={[localStyles.buttonText, { color: theme.text }]}>Rotate secret</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={confirmDelete}
            style={[localStyles.button, { backgroundColor: '#EF4444' }]}
          >
            <Text style={[localStyles.buttonText, { color: '#fff' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  )
}

function AddWebhookSheet({
  theme,
  workspaceId,
  onClose,
  onCreated,
}: {
  theme: Theme
  workspaceId: string
  onClose: () => void
  onCreated: () => void
}): React.ReactElement {
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [events, setEvents] = useState<Set<string>>(new Set(WEBHOOK_EVENT_TYPES))
  const [busy, setBusy] = useState(false)

  const canSave = useMemo(
    () => !busy && url.trim().startsWith('https://') && events.size > 0,
    [busy, events.size, url],
  )

  function toggleEvent(event: string): void {
    setEvents((current) => {
      const next = new Set(current)
      if (next.has(event)) next.delete(event)
      else next.add(event)
      return next
    })
  }

  async function save(): Promise<void> {
    if (!canSave) return
    setBusy(true)
    try {
      const created = await createWebhookSubscription(workspaceId, {
        url: url.trim(),
        events: Array.from(events),
        ...(description.trim() ? { description: description.trim() } : {}),
      })
      Alert.alert('Webhook created', `Signing secret (shown once):\n\n${created.secret}`, [
        { text: 'Copy secret', onPress: () => void Clipboard.setStringAsync(created.secret) },
        { text: 'Done', onPress: onCreated },
      ])
    } catch (err) {
      Alert.alert('Could not create webhook', err instanceof Error ? err.message : 'Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet theme={theme} visible onClose={onClose} title="New webhook">
      <View style={localStyles.sheetBody}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://your-endpoint/webhooks/overlay"
          placeholderTextColor={theme.textSecondary}
          style={[
            localStyles.input,
            { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor={theme.textSecondary}
          style={[
            localStyles.input,
            { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
          ]}
        />
        <Text style={[settingsStyles.fieldLabel, { color: theme.textSecondary }]}>Events</Text>
        <View style={localStyles.eventsWrap}>
          {WEBHOOK_EVENT_TYPES.map((event) => {
            const active = events.has(event)
            return (
              <TouchableOpacity
                key={event}
                activeOpacity={0.82}
                onPress={() => toggleEvent(event)}
                style={[
                  localStyles.eventChip,
                  {
                    borderColor: active ? theme.foreground : theme.border,
                    backgroundColor: active ? theme.surfaceSubtle : theme.surfaceElevated,
                  },
                ]}
              >
                <Text
                  style={[
                    localStyles.eventLabel,
                    { color: active ? theme.text : theme.textSecondary },
                  ]}
                >
                  {event}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
        <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
          Deliveries are signed with the secret shown after creation — keep it to verify payloads.
        </Text>
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={() => void save()}
          disabled={!canSave}
          style={[
            localStyles.button,
            { backgroundColor: theme.foreground, opacity: canSave ? 1 : 0.5 },
          ]}
        >
          <Text style={[localStyles.buttonText, { color: theme.background }]}>
            {busy ? 'Creating…' : 'Create webhook'}
          </Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  )
}

const localStyles = StyleSheet.create({
  sheetBody: {
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: borderRadius.full,
  },
  deliveryList: {
    flexGrow: 0,
    maxHeight: 260,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  eventsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  eventChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  eventLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  button: {
    flex: 1,
    minHeight: 42,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
})
