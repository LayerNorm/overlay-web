/**
 * Settings editors: each one is its own pushed Settings screen (like the iOS
 * Settings app) with a native SwiftUI form, saved from the navigation bar.
 * They replace the JS bottom sheets that used to open on top of Settings.
 */
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Alert, Linking, ScrollView, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import {
  Button,
  Form,
  HStack,
  Host,
  LabeledContent,
  Picker,
  SecureField,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
} from '@expo/ui/swift-ui'
import {
  autocorrectionDisabled,
  keyboardType,
  lineLimit,
  pickerStyle,
  tag,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../hooks/useTheme'
import { useSwitchTint } from '../../lib/nativeControls'
import { useAuth } from '../../contexts/AuthContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useLiveResource } from '../../hooks/useLiveResource'
import { useFavoriteModels } from '../../hooks/useFavoriteModels'
import { api } from '../../services/convexClient'
import { appJson } from '../../services/appApi'
import { updateUiSettings } from '../../services/settingsService'
import { createMemory, deleteMemory, updateMemory } from '../../services/knowledgeService'
import {
  cancelWorkspaceInvitation,
  inviteToWorkspace,
  resendWorkspaceInvitation,
} from '../../services/workspaceManagementService'
import {
  deleteAccountWithReauthentication,
  getAccountDeletionState,
  subscribeAccountDeletion,
} from '../../services/accountDeletionService'
import {
  BYOK_PROVIDER_PRESETS,
  createProviderConnection,
  deleteProviderConnection,
  discoveredModelsOf,
  getByokPreset,
  listProviderConnections,
  testProviderConnection,
  updateProviderConnection,
  type ProviderConnection,
} from '../../services/providersService'
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
import {
  subscriptionRequest,
  type SubscriptionAuthorization,
  type SubscriptionAvailability,
  type SubscriptionProgress,
} from '../../services/settingsNativeService'
import { ModelPicker } from '../chat/ModelPicker'
import { ActionRow, NavRow, secondary, sentence } from './SettingsViews'
import { AccountDeletionConfirmation } from './SettingsPrompts'
import { RoomNotifications } from './RoomNotifications'

export const SETTINGS_EDITORS = [
  'memory',
  'invite',
  'member',
  'delete-account',
  'room',
  'default-model',
  'provider',
  'add-provider',
  'subscription',
  'webhook',
  'add-webhook',
] as const
export type SettingsEditor = (typeof SETTINGS_EDITORS)[number]

const message = (value: unknown, fallback: string) => (value instanceof Error ? value.message : fallback)

/** The shared frame: title in the navigation bar, optional ✓ action, a native form. */
function EditorPage({
  title,
  save,
  children,
}: {
  title: string
  save?: { label: string; disabled?: boolean; onPress: () => void; icon?: 'checkmark' | 'paperplane' }
  children: React.ReactNode
}) {
  const { theme, isDark } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title }} />
      {save ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={save.icon ?? 'checkmark'}
            variant="prominent"
            tintColor={theme.foreground as string}
            accessibilityLabel={save.label}
            disabled={save.disabled}
            onPress={save.onPress}
          />
        </Stack.Toolbar>
      ) : null}
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>{children}</Form>
      </Host>
    </>
  )
}

function Loading({ title }: { title: string }) {
  const { theme } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.muted as string} />
      </View>
    </>
  )
}

function ErrorSection({ error }: { error: string | null }) {
  return error ? (
    <Section>
      <Text>{error}</Text>
    </Section>
  ) : null
}

/** Runs one async action at a time and keeps its error for the form. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const working = useRef(false)
  const run = useCallback(async (action: () => Promise<unknown>, fallback: string) => {
    if (working.current) return false
    working.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (value) {
      setError(message(value, fallback))
      return false
    } finally {
      working.current = false
      setBusy(false)
    }
  }, [])
  return { busy, error, setError, run }
}

export function SettingsEditorScreen({ editor }: { editor: SettingsEditor }) {
  switch (editor) {
    case 'memory':
      return <MemoryEditor />
    case 'invite':
      return <InviteEditor />
    case 'member':
      return <MemberEditor />
    case 'delete-account':
      return <DeleteAccountEditor />
    case 'room':
      return <RoomNotificationsEditor />
    case 'default-model':
      return <DefaultModelEditor />
    case 'provider':
      return <ProviderEditor />
    case 'add-provider':
      return <AddProviderEditor />
    case 'subscription':
      return <SubscriptionEditor />
    case 'webhook':
      return <WebhookEditor />
    case 'add-webhook':
      return <AddWebhookEditor />
  }
}

function useParam(name: string) {
  const params = useLocalSearchParams<Record<string, string>>()
  const value = params[name]
  return typeof value === 'string' && value ? value : undefined
}

// ---------------------------------------------------------------------------
// Memories

function MemoryEditor() {
  const id = useParam('id')
  const router = useRouter()
  const ready = useNativeDataReady()
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const memories = useLiveResource(api.knowledge.memoryBrowse.list, ready && workspaceId && id ? { workspaceId } : null)
  const row = id ? memories.data?.find((item) => item.memoryId === id) : undefined
  const [draft, setDraft] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  if (id && !row) return memories.loading || memories.data === undefined ? <Loading title="Memory" /> : <EditorPage title="Memory"><ErrorSection error="This memory is no longer available." /></EditorPage>
  const value = draft ?? row?.fullContent ?? ''
  const editable = !row || row.canDelete
  const save = () =>
    void run(() => (row ? updateMemory(row.memoryId, value.trim()) : createMemory(value.trim())), 'Could not save memory.').then(
      (ok) => ok && router.back(),
    )
  return (
    <EditorPage
      title={row ? 'Edit memory' : 'Add memory'}
      save={editable ? { label: 'Save memory', disabled: busy || !value.trim() || value.trim() === row?.fullContent, onPress: save } : undefined}
    >
      <Section footer={<Text>{editable ? 'Overlay uses memories to personalise answers.' : 'Only the person who saved this memory can change it.'}</Text>}>
        <TextField
          key={row?.memoryId ?? 'new'}
          defaultValue={value}
          placeholder="Something Overlay should remember"
          axis="vertical"
          autoFocus={!row}
          onValueChange={setDraft}
          modifiers={[lineLimit({ min: 3, max: 12 })]}
        />
      </Section>
      <ErrorSection error={error} />
      {row?.canDelete ? (
        <Section>
          <Button
            role="destructive"
            label="Delete memory"
            onPress={() =>
              Alert.alert('Delete this memory?', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => void run(() => deleteMemory(row.memoryId), 'Could not delete memory.').then((ok) => ok && router.back()),
                },
              ])
            }
          />
        </Section>
      ) : null}
    </EditorPage>
  )
}

// ---------------------------------------------------------------------------
// People

function InviteEditor() {
  const router = useRouter()
  const { activeWorkspaceId: workspaceId, activeWorkspace } = useWorkspace()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const { busy, error, setError, run } = useAction()
  const send = () => {
    const address = email.trim()
    if (!workspaceId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter a valid email address.')
      return
    }
    void run(() => inviteToWorkspace(workspaceId, address, role), 'Could not send the invitation.').then((ok) => ok && router.back())
  }
  return (
    <EditorPage title="Invite people" save={{ label: 'Send invitation', icon: 'paperplane', disabled: busy || !email.trim(), onPress: send }}>
      <Section footer={<Text>{`They'll get an email to join ${activeWorkspace?.name ?? 'this workspace'}.`}</Text>}>
        <TextField
          placeholder="name@company.com"
          autoFocus
          onValueChange={setEmail}
          modifiers={[keyboardType('email-address'), textInputAutocapitalization('never'), autocorrectionDisabled(true)]}
        />
      </Section>
      <Section title="Role" footer={<Text>{role === 'admin' ? 'Admins can invite people and manage the workspace.' : 'Members can chat, run agents and use shared files.'}</Text>}>
        <Picker selection={role} onSelectionChange={(value: 'member' | 'admin') => setRole(value)} modifiers={[pickerStyle('segmented')]}>
          <Text modifiers={[tag('member')]}>Member</Text>
          <Text modifiers={[tag('admin')]}>Admin</Text>
        </Picker>
      </Section>
      <ErrorSection error={error} />
    </EditorPage>
  )
}

function MemberEditor() {
  const id = useParam('id')
  const router = useRouter()
  const ready = useNativeDataReady()
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const people = useLiveResource(api.collaboration.management.view, ready && workspaceId ? { workspaceId, view: 'people' } : null)
  const row = people.data?.items.find((item) => item.id === id)
  const { busy, error, run } = useAction()
  if (!row) return people.data === undefined ? <Loading title="Member" /> : <EditorPage title="Member"><ErrorSection error="This person is no longer in the workspace." /></EditorPage>
  const invitation = row.kind === 'invitation' && row.invitationId && people.data?.canManage && workspaceId
  return (
    <EditorPage title={row.name}>
      <Section>
        <LabeledContent label={row.kind === 'invitation' ? 'Invited as' : 'Role'}>
          <Text>{sentence(row.role ?? row.badge ?? 'member')}</Text>
        </LabeledContent>
        {row.kind === 'invitation' && row.status ? (
          <LabeledContent label="Status">
            <Text>{sentence(row.status)}</Text>
          </LabeledContent>
        ) : null}
        {row.description || row.detail ? (
          <Text modifiers={[secondary, lineLimit(3)]}>{row.description ?? row.detail ?? ''}</Text>
        ) : null}
      </Section>
      <ErrorSection error={error} />
      {invitation ? (
        <Section>
          <ActionRow
            title={busy ? 'Sending…' : 'Resend invitation'}
            icon="arrow.clockwise"
            onPress={() => void run(() => resendWorkspaceInvitation(workspaceId, row.invitationId!), 'Could not resend.').then((ok) => ok && router.back())}
          />
          <Button
            role="destructive"
            label="Cancel invitation"
            onPress={() => void run(() => cancelWorkspaceInvitation(workspaceId, row.invitationId!), 'Could not cancel.').then((ok) => ok && router.back())}
          />
        </Section>
      ) : null}
    </EditorPage>
  )
}

// ---------------------------------------------------------------------------
// Account

function DeleteAccountEditor() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const deletion = useSyncExternalStore(subscribeAccountDeletion, getAccountDeletionState, getAccountDeletionState)
  const [confirmation, setConfirmation] = useState('')
  const { busy, error, run } = useAction()
  return (
    <EditorPage title="Delete account">
      <AccountDeletionConfirmation
        confirmation={confirmation}
        onChange={setConfirmation}
        busy={busy || deletion.busy}
        disabled={!user}
        error={error ?? deletion.error ?? null}
        onConfirm={() => {
          if (!user) return
          void run(
            () =>
              deleteAccountWithReauthentication(user.id, async () => {
                await signOut()
                router.replace('/auth-flow')
              }),
            'Could not delete your account.',
          )
        }}
      />
    </EditorPage>
  )
}

// ---------------------------------------------------------------------------
// Notifications

function RoomNotificationsEditor() {
  const id = useParam('id')
  const title = useParam('title') ?? 'Conversation'
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  return (
    <EditorPage title={title}>
      {workspaceId && id ? <RoomNotifications workspaceId={workspaceId} conversationId={id} /> : <ErrorSection error="This conversation is unavailable." />}
    </EditorPage>
  )
}

// ---------------------------------------------------------------------------
// Models

function DefaultModelEditor() {
  const router = useRouter()
  const { theme } = useTheme()
  const { user } = useAuth()
  const { chatModels, imageModels, videoModels, uiSettings } = useAppSession()
  const favorites = useFavoriteModels(user?.id)
  const { error, run } = useAction()
  const choose = (settings: Parameters<typeof updateUiSettings>[0]) =>
    void run(() => updateUiSettings(settings), 'Could not save the default model.').then((ok) => ok && router.back())
  return (
    <>
      <Stack.Screen options={{ title: 'Default model' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <ModelPicker
          theme={theme}
          models={chatModels}
          imageModels={imageModels}
          videoModels={videoModels}
          selectedId={uiSettings.defaultAskModelIds[0]}
          favoriteIds={favorites.favoriteIds}
          onFavorite={favorites.toggleFavorite}
          autoSelected={!uiSettings.defaultAskModelIds.length}
          onAuto={() => choose({ defaultAskModelIds: [] })}
          onSelect={(mode, id) =>
            choose(mode === 'text' ? { defaultAskModelIds: [id] } : mode === 'image' ? { defaultImageModelId: id } : { defaultVideoModelId: id })
          }
        />
        {error ? <Text>{error}</Text> : null}
      </ScrollView>
    </>
  )
}

function ProviderEditor() {
  const id = useParam('id')
  const router = useRouter()
  const [connection, setConnection] = useState<ProviderConnection | null | undefined>()
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  const [version, reload] = useState(0)
  const load = useCallback(() => reload((value) => value + 1), [])
  useEffect(() => {
    let active = true
    listProviderConnections()
      .then((rows) => active && setConnection(rows.find((row) => row._id === id) ?? null))
      .catch(() => active && setConnection(null))
    return () => {
      active = false
    }
  }, [id, version])
  if (connection === undefined) return <Loading title="API key" />
  if (!connection) return <EditorPage title="API key"><ErrorSection error="This connection is no longer available." /></EditorPage>
  const preset = getByokPreset(connection.providerId)
  const discovered = discoveredModelsOf(connection)
  const test = () =>
    void run(async () => {
      setResult(null)
      const outcome = await testProviderConnection({ connectionId: connection._id })
      if (!outcome.ok) {
        setResult(outcome.error ?? 'Connection test failed.')
        return
      }
      await updateProviderConnection({
        connectionId: connection._id,
        status: 'active',
        lastTestedAt: Date.now(),
        discoveredModelsJson: JSON.stringify({ data: outcome.models }),
        discoveredAt: Date.now(),
        enabledModelIds: outcome.models.map((model) => model.id),
      })
      setResult(`Connected · ${outcome.models.length} models found`)
      load()
    }, 'Connection test failed.')
  const rotate = () =>
    void run(async () => {
      await updateProviderConnection({ connectionId: connection._id, apiKey: apiKey.trim() })
      setApiKey('')
      setResult('Key saved. Test the connection to confirm it works.')
      load()
    }, 'Could not update the key.')
  return (
    <EditorPage
      title={connection.displayName}
      save={!connection.isDefault ? { label: 'Save key', disabled: busy || !apiKey.trim(), onPress: rotate } : undefined}
    >
      <Section>
        <LabeledContent label="Provider"><Text>{preset?.label ?? connection.providerId}</Text></LabeledContent>
        <LabeledContent label="Status"><Text>{sentence(connection.status)}</Text></LabeledContent>
        <LabeledContent label="Models">
          <Text>{String(discovered.length || connection.enabledModelIds.length)}</Text>
        </LabeledContent>
        <Text modifiers={[secondary, lineLimit(2)]}>{connection.endpoint}</Text>
      </Section>
      <Section footer={result ? <Text>{result}</Text> : connection.lastError ? <Text>{connection.lastError}</Text> : undefined}>
        <ActionRow title={busy ? 'Testing…' : 'Test connection'} icon="bolt.horizontal" onPress={test} />
        {preset?.docsURL ? <ActionRow title="Provider docs" icon="book" onPress={() => void Linking.openURL(preset.docsURL)} /> : null}
      </Section>
      {connection.isDefault ? (
        <Section footer={<Text>The built-in Overlay provider can&apos;t be edited or removed.</Text>}>{null}</Section>
      ) : (
        <Section title="Replace API key" footer={<Text>Saved keys are never shown. Enter a new key and tap the check to replace it.</Text>}>
          <SecureField key={`key:${result ?? ''}`} placeholder="New API key" onValueChange={setApiKey} />
        </Section>
      )}
      <ErrorSection error={error} />
      {connection.isDeletable && !connection.isDefault ? (
        <Section>
          <Button
            role="destructive"
            label="Remove connection"
            onPress={() =>
              Alert.alert('Remove this connection?', `${connection.displayName} and its API key are deleted.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => void run(() => deleteProviderConnection(connection._id), 'Could not remove.').then((ok) => ok && router.back()),
                },
              ])
            }
          />
        </Section>
      ) : null}
    </EditorPage>
  )
}

function AddProviderEditor() {
  const router = useRouter()
  const [presetId, setPresetId] = useState<string>(BYOK_PROVIDER_PRESETS[0].id)
  const preset = BYOK_PROVIDER_PRESETS.find((item) => item.id === presetId) ?? BYOK_PROVIDER_PRESETS[0]
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  const target = preset.allowsCustomEndpoint ? endpoint.trim() : preset.defaultBaseURL
  const canSave =
    !busy && name.trim().length > 0 && (!preset.requiresApiKey || apiKey.trim().length > 0) && (!preset.allowsCustomEndpoint || target.startsWith('https://'))
  const test = () =>
    void run(async () => {
      setResult(null)
      const outcome = await testProviderConnection({
        providerId: preset.id,
        ...(target ? { endpoint: target } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setResult(outcome.ok ? `Connected · ${outcome.models.length} models found` : (outcome.error ?? 'Connection test failed.'))
    }, 'Connection test failed.')
  const save = () =>
    void run(
      () =>
        createProviderConnection({
          providerId: preset.id,
          displayName: name.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(preset.allowsCustomEndpoint && target ? { endpoint: target } : {}),
        }),
      'Could not add the provider.',
    ).then((ok) => ok && router.back())
  return (
    <EditorPage title="Add API key" save={{ label: 'Add provider', disabled: !canSave, onPress: save }}>
      <Section>
        <Picker label="Provider" selection={presetId} onSelectionChange={(value: string) => setPresetId(value)} modifiers={[pickerStyle('menu')]}>
          {BYOK_PROVIDER_PRESETS.map((option) => (
            <Text key={option.id} modifiers={[tag(option.id)]}>{option.label}</Text>
          ))}
        </Picker>
        <TextField placeholder={`Name (e.g. ${preset.label})`} onValueChange={setName} modifiers={[textInputAutocapitalization('words')]} />
        {preset.allowsCustomEndpoint ? (
          <TextField
            placeholder="https://your-endpoint/v1"
            onValueChange={setEndpoint}
            modifiers={[keyboardType('url'), textInputAutocapitalization('never'), autocorrectionDisabled(true)]}
          />
        ) : (
          <LabeledContent label="Endpoint"><Text modifiers={[lineLimit(1)]}>{preset.defaultBaseURL}</Text></LabeledContent>
        )}
      </Section>
      <Section footer={<Text>Keys are stored on Overlay&apos;s servers, never on this device.</Text>}>
        <SecureField placeholder={preset.requiresApiKey ? 'API key' : 'API key (optional)'} onValueChange={setApiKey} />
      </Section>
      <Section footer={result ? <Text>{result}</Text> : undefined}>
        <ActionRow title={busy ? 'Testing…' : 'Test connection'} icon="bolt.horizontal" onPress={test} />
      </Section>
      <ErrorSection error={error} />
    </EditorPage>
  )
}

function SubscriptionEditor() {
  const connectionId = useParam('id')
  const providerId = useParam('provider')
  const router = useRouter()
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const [availability, setAvailability] = useState<SubscriptionAvailability | null>(null)
  const [login, setLogin] = useState<SubscriptionAuthorization | null>(null)
  const [scope, setScope] = useState<'personal' | 'workspace'>('personal')
  const [callback, setCallback] = useState('')
  const [stopped, setStopped] = useState(false)
  const { busy, error, setError, run } = useAction()
  const active = useRef(true)
  const pendingId = useRef<string | null>(null)
  const connected = useRef(false)
  const request = useRef<{ signature: string; key: string } | null>(null)
  useEffect(() => {
    active.current = true
    if (workspaceId)
      void subscriptionRequest<SubscriptionAvailability>(workspaceId)
        .then((value) => active.current && setAvailability(value))
        .catch((value) => active.current && setError(message(value, 'Connections unavailable.')))
    return () => {
      active.current = false
      // Leaving before sign-in finishes removes the half-made connection.
      if (workspaceId && pendingId.current && !connected.current)
        void appJson('/api/v1/providers/connections', { method: 'DELETE', workspaceId, query: { connectionId: pendingId.current } }).catch(() => undefined)
    }
  }, [workspaceId, setError])
  const accept = useCallback(
    (result: SubscriptionProgress) => {
      if (result.status === 'connected') {
        connected.current = true
        router.back()
      } else if (result.status === 'expired' || (result.status === 'error' && !result.retryable)) {
        setStopped(true)
        setError(result.error ?? 'Sign-in expired. Go back and try again.')
      } else if (result.status === 'error') setError(result.error ?? 'Could not check sign-in. Retrying.')
    },
    [router, setError],
  )
  useEffect(() => {
    if (!login || stopped || login.authorization.callbackRequired || !workspaceId) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (abort.signal.aborted || !active.current) return
      if (Date.now() >= login.authorization.expiresAt) {
        setStopped(true)
        setError('Sign-in expired. Go back and try again.')
        return
      }
      try {
        const result = await subscriptionRequest<SubscriptionProgress>(workspaceId, { connectionId: login.connectionId, action: 'poll' }, 'PATCH', abort.signal)
        if (!abort.signal.aborted && active.current) accept(result)
        if (result.status !== 'pending' && !(result.status === 'error' && result.retryable)) return
      } catch (value) {
        if (!abort.signal.aborted && active.current) setError(message(value, 'Could not check sign-in.'))
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), Math.max(2, login.authorization.interval) * 1000)
    }
    timer = setTimeout(() => void poll(), Math.max(2, login.authorization.interval) * 1000)
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [login, stopped, workspaceId, accept, setError])
  const start = (provider: string) =>
    void run(async () => {
      if (!workspaceId) return
      const body = providerId && connectionId ? { providerId: provider, connectionId } : { providerId: provider, scope }
      const signature = JSON.stringify(body)
      if (request.current?.signature !== signature) request.current = { signature, key: Crypto.randomUUID() }
      const result = await subscriptionRequest<SubscriptionAuthorization>(workspaceId, body, 'POST', undefined, request.current.key)
      if (!active.current) {
        void appJson('/api/v1/providers/connections', { method: 'DELETE', workspaceId, query: { connectionId: result.connectionId } }).catch(() => undefined)
        return
      }
      pendingId.current = result.connectionId
      request.current = null
      setLogin(result)
    }, 'Could not start sign-in.')
  if (!availability && !error) return <Loading title="Subscription" />
  return (
    <EditorPage title={connectionId ? 'Reconnect subscription' : 'Connect a subscription'}>
      {!login ? (
        <>
          {!connectionId ? (
            <Section title="Available to">
              <Picker selection={scope} onSelectionChange={(value: 'personal' | 'workspace') => setScope(value)} modifiers={[pickerStyle('segmented')]}>
                <Text modifiers={[tag('personal')]}>Just me</Text>
                <Text modifiers={[tag('workspace')]}>Workspace</Text>
              </Picker>
            </Section>
          ) : null}
          <Section
            title="Provider"
            footer={<Text>{availability?.available ? 'Sign in with an account you already pay for.' : (availability?.reason ?? 'Subscription connections aren’t available here.')}</Text>}
          >
            {availability?.available
              ? availability.providers
                  .filter((provider) => !providerId || provider.id === providerId)
                  .map((provider) => (
                    <Button key={provider.id} onPress={provider.enabled && !busy ? () => start(provider.id) : undefined}>
                      <HStack>
                        <Text>{provider.label}</Text>
                        <Spacer />
                        <Text modifiers={[secondary]}>{provider.enabled ? 'Connect' : 'Unavailable'}</Text>
                      </HStack>
                    </Button>
                  ))
              : null}
          </Section>
        </>
      ) : (
        <>
          <Section
            title="Sign in"
            footer={<Text>{login.authorization.userCode ? `Enter this code when asked: ${login.authorization.userCode}` : 'Finish signing in in your browser, then come back.'}</Text>}
          >
            <ActionRow
              title="Open sign-in"
              icon="safari"
              onPress={() => {
                if (stopped) return
                const url = new URL(login.authorization.url)
                if (url.protocol !== 'https:') {
                  setError('Unexpected sign-in address.')
                  return
                }
                void Linking.openURL(url.href).catch(() => setError('Could not open sign-in.'))
              }}
            />
            {login.authorization.userCode ? (
              <ActionRow title="Copy code" icon="doc.on.doc" onPress={() => void Clipboard.setStringAsync(login.authorization.userCode ?? '')} />
            ) : null}
          </Section>
          {login.authorization.callbackRequired ? (
            <Section title="Callback address" footer={<Text>After signing in, paste the full address from your browser. A localhost error page is expected.</Text>}>
              <TextField placeholder="http://localhost…" onValueChange={setCallback} modifiers={[textInputAutocapitalization('never'), autocorrectionDisabled(true), keyboardType('url')]} />
              <ActionRow
                title={busy ? 'Connecting…' : 'Complete connection'}
                icon="checkmark.circle"
                onPress={() => {
                  if (!callback.trim() || stopped || !workspaceId) return
                  void run(async () => {
                    const result = await subscriptionRequest<SubscriptionProgress>(workspaceId, {
                      connectionId: login.connectionId,
                      action: 'callback',
                      callbackUrl: callback.trim(),
                    })
                    if (active.current) accept(result)
                  }, 'Could not complete sign-in.')
                }}
              />
            </Section>
          ) : (
            <Section>
              <Text modifiers={[secondary]}>Waiting for you to finish signing in…</Text>
            </Section>
          )}
        </>
      )}
      <ErrorSection error={error} />
    </EditorPage>
  )
}

// ---------------------------------------------------------------------------
// Webhooks

/** The Webhooks page: one row per subscription, each opening its own screen. */
export function WebhooksList({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [rows, setRows] = useState<WebhookSubscription[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void listWebhookSubscriptions(workspaceId)
      .then((value) => active && setRows(value))
      .catch((value) => active && setError(message(value, 'Webhooks are unavailable.')))
    return () => {
      active = false
    }
  }, [workspaceId])
  return (
    <>
      <Section
        title="Subscriptions"
        footer={<Text>{error ?? (rows && !rows.length ? 'Overlay sends signed events to any HTTPS address you add.' : 'Signed events Overlay sends to your servers.')}</Text>}
      >
        {rows === null && !error ? <Text modifiers={[secondary]}>Loading…</Text> : null}
        {rows?.map((row) => (
          <NavRow
            key={row._id}
            title={row.description?.trim() || row.url}
            value={row.enabled ? 'On' : 'Off'}
            onPress={() => router.push({ pathname: '/settings', params: { section: 'webhook', id: row._id } })}
          />
        ))}
        <ActionRow title="Add webhook" icon="plus" onPress={() => router.push({ pathname: '/settings', params: { section: 'add-webhook' } })} />
      </Section>
    </>
  )
}

function WebhookEditor() {
  const switchTint = useSwitchTint()
  const id = useParam('id')
  const router = useRouter()
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const [row, setRow] = useState<WebhookSubscription | null | undefined>()
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null)
  const { busy, error, run } = useAction()
  const [version, reload] = useState(0)
  const load = useCallback(() => reload((value) => value + 1), [])
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    const read = async () => {
      const rows = await listWebhookSubscriptions(workspaceId)
      const found = rows.find((item) => item._id === id) ?? null
      const recent = found ? await listWebhookDeliveries(workspaceId, { subscriptionId: found._id, limit: 20 }).catch(() => []) : []
      if (!active) return
      setRow(found)
      setDeliveries(recent)
    }
    read().catch(() => active && setRow(null))
    return () => {
      active = false
    }
  }, [workspaceId, id, version])
  if (row === undefined) return <Loading title="Webhook" />
  if (!row || !workspaceId) return <EditorPage title="Webhook"><ErrorSection error="This webhook is no longer available." /></EditorPage>
  return (
    <EditorPage title={row.description?.trim() || 'Webhook'}>
      <Section footer={<Text>{`Events: ${row.events.join(', ')}`}</Text>}>
        <Toggle
          modifiers={switchTint}
          label="Enabled"
          isOn={row.enabled}
          onIsOnChange={(enabled) => void run(async () => {
            await updateWebhookSubscription(workspaceId, { subscriptionId: row._id, enabled })
            load()
          }, 'Could not update the webhook.')}
        />
        <Text modifiers={[secondary, lineLimit(3)]}>{row.url}</Text>
      </Section>
      <Section title="Recent deliveries" footer={deliveries && !deliveries.length ? <Text>No deliveries yet.</Text> : undefined}>
        {deliveries === null ? <Text modifiers={[secondary]}>Loading…</Text> : null}
        {deliveries?.map((delivery) => {
          const retry = delivery.status === 'failed' || delivery.status === 'dead_letter'
          return (
            <Button
              key={delivery._id}
              onPress={retry && !busy ? () => void run(async () => {
                await redriveWebhookDelivery(workspaceId, delivery._id)
                load()
              }, 'Could not retry the delivery.') : undefined}
            >
              <HStack>
                <Text modifiers={[lineLimit(1)]}>{delivery.eventType}</Text>
                <Spacer />
                <Text modifiers={[secondary]}>
                  {retry ? `${sentence(delivery.status)} · Retry` : `${sentence(delivery.status)}${delivery.lastStatusCode ? ` · ${delivery.lastStatusCode}` : ''}`}
                </Text>
              </HStack>
            </Button>
          )
        })}
      </Section>
      <ErrorSection error={error} />
      <Section footer={<Text>The current secret stops working immediately. The new one is shown once.</Text>}>
        <ActionRow
          title="Rotate signing secret"
          icon="key"
          onPress={() =>
            Alert.alert('Rotate the signing secret?', 'The current secret stops working right away.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Rotate',
                onPress: () =>
                  void run(async () => {
                    const secret = await rotateWebhookSecret(workspaceId, row._id)
                    Alert.alert('New signing secret', secret, [
                      { text: 'Copy', onPress: () => void Clipboard.setStringAsync(secret) },
                      { text: 'Done' },
                    ])
                  }, 'Could not rotate the secret.'),
              },
            ])
          }
        />
      </Section>
      <Section>
        <Button
          role="destructive"
          label="Delete webhook"
          onPress={() =>
            Alert.alert('Delete this webhook?', `Events stop going to ${row.url}.`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => void run(() => deleteWebhookSubscription(workspaceId, row._id), 'Could not delete.').then((ok) => ok && router.back()),
              },
            ])
          }
        />
      </Section>
    </EditorPage>
  )
}

function AddWebhookEditor() {
  const switchTint = useSwitchTint()
  const router = useRouter()
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [events, setEvents] = useState<Set<string>>(() => new Set(WEBHOOK_EVENT_TYPES))
  const { busy, error, run } = useAction()
  const canSave = !busy && url.trim().startsWith('https://') && events.size > 0 && Boolean(workspaceId)
  const save = () =>
    void run(async () => {
      if (!workspaceId) return
      const created = await createWebhookSubscription(workspaceId, {
        url: url.trim(),
        events: Array.from(events),
        ...(description.trim() ? { description: description.trim() } : {}),
      })
      Alert.alert('Webhook created', `Copy the signing secret now. It isn’t shown again.\n\n${created.secret}`, [
        { text: 'Copy secret', onPress: () => void Clipboard.setStringAsync(created.secret).then(() => router.back()) },
        { text: 'Done', onPress: () => router.back() },
      ])
    }, 'Could not create the webhook.')
  return (
    <EditorPage title="Add webhook" save={{ label: 'Create webhook', disabled: !canSave, onPress: save }}>
      <Section footer={<Text>Must start with https://</Text>}>
        <TextField
          placeholder="https://your-server/webhooks/overlay"
          autoFocus
          onValueChange={setUrl}
          modifiers={[keyboardType('url'), textInputAutocapitalization('never'), autocorrectionDisabled(true)]}
        />
        <TextField placeholder="Description (optional)" onValueChange={setDescription} />
      </Section>
      <Section title="Events">
        {WEBHOOK_EVENT_TYPES.map((event) => (
          <Toggle
            modifiers={switchTint}
            key={event}
            label={event}
            isOn={events.has(event)}
            onIsOnChange={(on) =>
              setEvents((current) => {
                const next = new Set(current)
                if (on) next.add(event)
                else next.delete(event)
                return next
              })
            }
          />
        ))}
      </Section>
      <ErrorSection error={error} />
    </EditorPage>
  )
}
