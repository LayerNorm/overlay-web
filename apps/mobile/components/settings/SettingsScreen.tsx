import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, AppState, Linking, NativeModules, Platform, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import * as Notifications from 'expo-notifications'
import type { MemoryRow } from '@overlay/app-core'
import type { WorkspaceManagementItem } from '@overlay/workspace-contracts'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../contexts/AuthContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useDrawer } from '../../contexts/DrawerContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useLiveResource } from '../../hooks/useLiveResource'
import { useMobilePreferences } from '../../hooks/useMobilePreferences'
import { useFavoriteModels } from '../../hooks/useFavoriteModels'
import { api } from '../../services/convexClient'
import { appRequest } from '../../services/appApi'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { updateUiSettings } from '../../services/settingsService'
import { createMemory, updateMemory, deleteMemory } from '../../services/knowledgeService'
import {
  inviteToWorkspace,
  resendWorkspaceInvitation,
  cancelWorkspaceInvitation,
} from '../../services/workspaceManagementService'
import { saveAccountName } from '../../services/settingsNativeService'
import {
  deleteAccountWithReauthentication,
  getAccountDeletionState,
  subscribeAccountDeletion,
} from '../../services/accountDeletionService'
import {
  DEFAULT_BANNER_PREFERENCES,
  loadBannerPreferences,
  saveBannerPreferences,
  type BannerPreferences,
} from '../../services/bannerPreferencesService'
import {
  preparePushRegistration,
  requestNotificationPermission,
} from '../../services/notificationsService'
import {
  clearTranscriptionHistory,
  disableBackgroundVoice,
  enableBackgroundVoice,
  getBackgroundVoiceEnabled,
  getTranscriptionHistory,
  pruneTranscriptionHistory,
} from '../../services/voiceService'
import { ResourcePage, ResourceSheet, ResourceState } from '../knowledge/ResourceViews'
import { T, Button } from '../shell/primitives'
import { ModelPicker } from '../chat/ModelPicker'
import { ProvidersSection } from './ProvidersSection'
import { SubscriptionSheet } from './SubscriptionSheet'
import { SETTINGS_PAGES, SettingsView, type SettingsPage } from './SettingsViews'
import { accountPhotoSource } from '../../lib/settingsPhoto'
import { RoomNotifications } from './RoomNotifications'
import { AccountDeletionConfirmation, PushPrePrompt } from './SettingsPrompts'

type Dialog =
  | { kind: 'room'; conversationId: string }
  | { kind: 'memory'; row?: MemoryRow }
  | { kind: 'invitation'; row: WorkspaceManagementItem }
  | { kind: 'invite' | 'delete' | 'model' | 'api' | 'appearance' | 'retention' }
  | { kind: 'subscription'; connectionId?: string; providerId?: string }
export default function SettingsScreen() {
  const { activeWorkspaceId } = useWorkspace()
  return <SettingsScope key={activeWorkspaceId} />
}
function SettingsScope() {
  const { section } = useLocalSearchParams<{ section?: string }>()
  const initial = SETTINGS_PAGES.some((row) => row[0] === section)
    ? (section as SettingsPage)
    : 'settings'
  const [page, setPage] = useState<SettingsPage>(initial)
  useEffect(() => {
    if (section && SETTINGS_PAGES.some((row) => row[0] === section))
      setPage(section as SettingsPage)
  }, [section])
  const { theme, appearanceMode, setAppearanceMode, isDark } = useTheme()
  const { user, session, signOut } = useAuth()
  const { activeWorkspaceId: workspaceId, activeWorkspace } = useWorkspace()
  const { chatModels, imageModels, videoModels, uiSettings } = useAppSession()
  const { openDrawer } = useDrawer()
  const { top } = useSafeAreaInsets()
  const router = useRouter()
  const ready = useNativeDataReady()
  const favorites = useFavoriteModels(user?.id)
  const rooms = useLiveResource(
    api.collaboration.roomList.list,
    ready && workspaceId && (page === 'notifications' || page === 'push-permission')
      ? { workspaceId, kind: 'all', limit: 500 }
      : null,
  )
  const { preferences, updatePreferences } = useMobilePreferences()
  const memories = useLiveResource(
    api.knowledge.memoryBrowse.list,
    ready && workspaceId && page === 'memories' ? { workspaceId } : null,
  )
  const people = useLiveResource(
    api.collaboration.management.view,
    ready && workspaceId && page === 'members' ? { workspaceId, view: 'people' } : null,
  )
  const billing = useLiveResource(
    api.billing.browse.workspaceSummary,
    ready && workspaceId && page === 'billing' ? { workspaceId } : null,
  )
  const providers = useLiveResource(
    api.providers.browse.connections,
    ready && workspaceId && page === 'models' ? { workspaceId } : null,
  )
  const profile = useLiveResource(
    api.auth.accountBrowse.identity,
    ready && page === 'account' ? {} : null,
    user?.id,
  )
  const deletion = useSyncExternalStore(
    subscribeAccountDeletion,
    getAccountDeletionState,
    getAccountDeletionState,
  )
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [draft, setDraft] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [bannerPreferences, setBannerPreferences] = useState<BannerPreferences>(
    DEFAULT_BANNER_PREFERENCES,
  )
  const [permission, setPermission] = useState('Not requested')
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [historyCount, setHistoryCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const working = useRef(false)
  const currentScope = useRef(workspaceId)
  currentScope.current = workspaceId
  useEffect(() => {
    setDialog(null)
    setError(null)
  }, [workspaceId])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    let active = true
    if (user?.id)
      void loadBannerPreferences(user.id)
        .then((value) => {
          if (active) setBannerPreferences(value)
        })
        .catch(() => {
          if (active) setError('Could not load device preferences.')
        })
    const refreshPermission = () =>
      void Notifications.getPermissionsAsync()
        .then((value) => {
          if (active)
            setPermission(
              value.granted
                ? 'Allowed'
                : value.canAskAgain
                  ? 'Not requested'
                  : 'Denied · enable in device settings',
            )
        })
        .catch(() => undefined)
    refreshPermission()
    const permissionListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPermission()
    })
    return () => {
      active = false
      permissionListener.remove()
    }
  }, [user?.id])
  const loadVoice = async () => {
    const [enabled, history] = await Promise.all([
      getBackgroundVoiceEnabled(),
      getTranscriptionHistory(),
    ])
    if (alive.current) {
      setVoiceEnabled(enabled)
      setHistoryCount(history.length)
    }
  }
  useEffect(() => {
    if (page === 'voice') void loadVoice().catch(() => setError('Could not load voice settings.'))
  }, [page])
  const run = async (action: () => Promise<unknown>, close = false) => {
    if (working.current || deletion.busy) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      if (close && alive.current && currentScope.current === workspaceId) setDialog(null)
    } catch (value) {
      if (alive.current && currentScope.current === workspaceId)
        setError(value instanceof Error ? value.message : 'Could not complete this action.')
    } finally {
      working.current = false
      if (alive.current) setBusy(false)
    }
  }
  const open = (value: Dialog) => {
    if (working.current || deletion.busy) return
    setError(null)
    setDialog(value)
  }
  const resource =
    page === 'memories'
      ? memories
      : page === 'members'
        ? people
        : page === 'billing'
          ? billing
          : page === 'models'
            ? providers
            : page === 'account'
              ? profile
              : null
  const unavailable =
    resource?.data === null && page !== 'account'
      ? 'This information is unavailable in this workspace.'
      : null
  const data = {
    dark: isDark,
    rooms: rooms.data?.rooms.map((row) => ({ id: row._id, title: row.title || 'Conversation' })),
    memories: memories.data ?? [],
    members: people.data?.items ?? [],
    canManage: people.data?.canManage,
    billing: billing.data,
    providers: providers.data ?? [],
    profile: {
      displayName: profile.data?.displayName ?? user?.email ?? 'Your account',
      email: profile.data?.email ?? user?.email ?? '',
      ...accountPhotoSource(profile.data?.photoUrl, AUTH_BASE_URL, session?.accessToken),
    },
    workspaceName: activeWorkspace?.name,
    defaultModel:
      chatModels.find((row) => row.id === uiSettings.defaultAskModelIds[0])?.name ?? 'Auto',
    bannerPreferences,
    permission,
    voiceEnabled,
    voiceSupported:
      Platform.OS === 'ios' &&
      typeof NativeModules.SharedKeyStore?.setBackgroundModeEnabled === 'function',
    retention: preferences.transcriptionRetentionDays,
    historyCount,
    appearance: appearanceMode === 'auto' ? 'System' : appearanceMode === 'dark' ? 'Dark' : 'Light',
  }
  const field = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    multiline = false,
  ) => (
    <View style={{ gap: 8 }}>
      <T style={{ color: theme.muted, fontSize: 12 }}>{label}</T>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        value={value}
        onChangeText={onChangeText}
        style={{
          color: theme.foreground,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 8,
          padding: 12,
          minHeight: multiline ? 130 : 44,
          textAlignVertical: multiline ? 'top' : 'center',
          fontSize: 14,
          fontFamily: 'Geist',
        }}
      />
    </View>
  )
  const close = () => {
    if (!busy && !deletion.busy) setDialog(null)
  }
  const finishSignOut = async () => {
    await signOut()
    router.replace('/auth-flow')
  }
  const requestPermission = () =>
    void run(async () => {
      const current = await Notifications.getPermissionsAsync()
      if (!current.granted && !current.canAskAgain) {
        await Linking.openSettings()
        return
      }
      const granted = await requestNotificationPermission()
      setPermission(
        granted
          ? 'Allowed · background delivery not available yet'
          : 'Denied · enable in device settings',
      )
      if (granted && user) await preparePushRegistration(user.id)
    })
  return (
    <ResourcePage
      theme={theme}
      section="Settings"
      topInset={top}
      onDrawer={workspaceId ? openDrawer : () => router.replace('/')}
      onBack={
        page === 'settings'
          ? undefined
          : () => {
              if (!workspaceId) {
                router.replace('/')
                return
              }
              setPage('settings')
              setError(null)
            }
      }
    >
      <SettingsView
        key={page === 'push-permission' ? 'notifications' : page}
        theme={theme}
        page={page === 'push-permission' ? 'notifications' : page}
        data={data}
        loading={resource?.loading}
        blocked={Boolean(resource?.error || unavailable)}
        busy={busy || deletion.busy}
        error={resource?.error ?? unavailable ?? (dialog ? null : (error ?? deletion.error))}
        onRetry={resource?.retry}
        actions={{
          room: (conversationId) => open({ kind: 'room', conversationId }),
          navigate: (next) => {
            setPage(next)
            setError(null)
          },
          memory: (row) => {
            setDraft(row?.fullContent ?? '')
            open({ kind: 'memory', row })
          },
          invite: () => {
            setEmail('')
            setRole('member')
            open({ kind: 'invite' })
          },
          invitation: (row) => open({ kind: 'invitation', row }),
          connection: (id) => {
            const row = providers.data?.find((item) => item._id === id)
            open(
              id === 'new-api' || (row && row.authKind !== 'subscription')
                ? { kind: 'api' }
                : { kind: 'subscription', connectionId: id, providerId: row?.subscriptionProvider },
            )
          },
          defaultModel: () => open({ kind: 'model' }),
          banner: (category, enabled) => {
            if (user)
              void run(async () => {
                const next = { ...bannerPreferences, [category]: enabled }
                await saveBannerPreferences(user.id, next)
                setBannerPreferences(next)
              })
          },
          voice: (enabled) =>
            void run(async () => {
              if (enabled) {
                const result = await enableBackgroundVoice()
                if (!result.enabled)
                  throw new Error('Microphone permission or the voice extension is unavailable.')
              } else await disableBackgroundVoice()
              await loadVoice()
            }),
          retention: () => open({ kind: 'retention' }),
          clearHistory: () =>
            Alert.alert(
              'Clear transcription history?',
              'This removes transcriptions from this device.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear',
                  style: 'destructive',
                  onPress: () =>
                    void run(async () => {
                      await clearTranscriptionHistory()
                      await loadVoice()
                    }),
                },
              ],
            ),
          saveName: async (name) => {
            await saveAccountName(name)
          },
          photo: () =>
            void run(async () => {
              const choice = await DocumentPicker.getDocumentAsync({
                type: 'image/*',
                copyToCacheDirectory: true,
              })
              if (choice.canceled) return
              const file = choice.assets[0]
              const body = new FormData()
              body.append('file', {
                uri: file.uri,
                name: file.name,
                type: file.mimeType ?? 'image/jpeg',
              } as unknown as Blob)
              await appRequest('/api/v1/account/profile/photo', {
                method: 'POST',
                formData: body,
                workspaceId,
              })
            }),
          signOut: () => {
            if (!deletion.busy) void run(finishSignOut)
          },
          deleteAccount: () => {
            setDraft('')
            open({ kind: 'delete' })
          },
          help: (kind) =>
            void run(() =>
              Linking.openURL(
                kind === 'docs'
                  ? 'https://www.getoverlay.io/docs'
                  : kind === 'email'
                    ? 'mailto:support@getoverlay.io'
                    : `${AUTH_BASE_URL}/home`,
              ),
            ),
          appearance: () => open({ kind: 'appearance' }),
          permission: requestPermission,
        }}
      />
      {page === 'push-permission' ? (
        <ResourceSheet
          theme={theme}
          visible
          title="Stay in the loop"
          onClose={() => {
            if (!busy) setPage('notifications')
          }}
        >
          <PushPrePrompt
            theme={theme}
            permission={permission}
            busy={busy}
            onContinue={requestPermission}
            onLater={() => setPage('notifications')}
          />
        </ResourceSheet>
      ) : null}
      {dialog?.kind === 'subscription' && workspaceId ? (
        <SubscriptionSheet
          theme={theme}
          workspaceId={workspaceId}
          connectionId={dialog.connectionId}
          providerId={dialog.providerId}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'room' && workspaceId ? (
        <RoomNotifications
          theme={theme}
          workspaceId={workspaceId}
          conversationId={dialog.conversationId}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {page === 'notifications' && rooms.error ? (
        <ResourceState theme={theme} error={rooms.error} onRetry={rooms.retry} />
      ) : null}
      {dialog && dialog.kind !== 'subscription' && dialog.kind !== 'room' ? (
        <ResourceSheet
          theme={theme}
          visible
          title={
            dialog.kind === 'delete'
              ? 'Delete account'
              : dialog.kind === 'memory'
                ? dialog.row
                  ? 'Edit memory'
                  : 'Add memory'
                : dialog.kind === 'invite'
                  ? 'Invite member'
                  : dialog.kind === 'invitation'
                    ? dialog.row.name
                    : dialog.kind === 'model'
                      ? 'Default model'
                      : dialog.kind === 'api'
                        ? 'API connections'
                        : dialog.kind === 'retention'
                          ? 'Keep transcriptions'
                          : 'Appearance'
          }
          onClose={close}
        >
          <View style={{ gap: 16 }}>
            {error && dialog.kind !== 'delete' ? (
              <ResourceState theme={theme} error={error} />
            ) : null}
            {dialog.kind === 'memory' ? (
              <>
                {field('Memory', draft, setDraft, true)}
                <Button
                  theme={theme}
                  secondary
                  disabled={busy || !draft.trim() || Boolean(dialog.row && !dialog.row.canDelete)}
                  onPress={() =>
                    void run(
                      () =>
                        dialog.row
                          ? updateMemory(dialog.row.memoryId, draft.trim())
                          : createMemory(draft.trim()),
                      true,
                    )
                  }
                >
                  Save memory
                </Button>
                {dialog.row?.canDelete ? (
                  <Button
                    theme={theme}
                    disabled={busy}
                    onPress={() =>
                      Alert.alert('Delete memory?', 'This cannot be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => void run(() => deleteMemory(dialog.row!.memoryId), true),
                        },
                      ])
                    }
                  >
                    Delete memory
                  </Button>
                ) : null}
              </>
            ) : null}
            {dialog.kind === 'invite' ? (
              <>
                {field('Email', email, setEmail)}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['member', 'admin'] as const).map((value) => (
                    <Button
                      key={value}
                      theme={theme}
                      secondary={role === value}
                      disabled={busy}
                      onPress={() => setRole(value)}
                    >
                      {value === 'member' ? 'Member' : 'Admin'}
                    </Button>
                  ))}
                </View>
                <Button
                  theme={theme}
                  secondary
                  disabled={busy || !email.trim()}
                  onPress={() =>
                    void run(async () => {
                      if (!workspaceId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
                        throw new Error('Enter a valid email address.')
                      await inviteToWorkspace(workspaceId, email.trim(), role)
                    }, true)
                  }
                >
                  Send invitation
                </Button>
              </>
            ) : null}
            {dialog.kind === 'invitation' ? (
              <>
                <T style={{ color: theme.muted }}>
                  {dialog.row.description ?? dialog.row.detail ?? dialog.row.role}
                </T>
                {dialog.row.kind === 'invitation' &&
                dialog.row.invitationId &&
                people.data?.canManage &&
                workspaceId ? (
                  <>
                    <Button
                      theme={theme}
                      secondary
                      disabled={busy}
                      onPress={() =>
                        void run(
                          () => resendWorkspaceInvitation(workspaceId, dialog.row.invitationId!),
                          true,
                        )
                      }
                    >
                      Resend invitation
                    </Button>
                    <Button
                      theme={theme}
                      disabled={busy}
                      onPress={() =>
                        void run(
                          () => cancelWorkspaceInvitation(workspaceId, dialog.row.invitationId!),
                          true,
                        )
                      }
                    >
                      Cancel invitation
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            {dialog.kind === 'delete' ? (
              <AccountDeletionConfirmation
                theme={theme}
                confirmation={draft}
                onChange={setDraft}
                busy={busy || deletion.busy}
                disabled={!user}
                error={error ?? deletion.error}
                onConfirm={() => {
                  if (user)
                    void run(() => deleteAccountWithReauthentication(user.id, finishSignOut), true)
                }}
              />
            ) : null}
            {dialog.kind === 'model' ? (
              <ModelPicker
                theme={theme}
                models={chatModels}
                imageModels={imageModels}
                videoModels={videoModels}
                selectedId={uiSettings.defaultAskModelIds[0]}
                favoriteIds={favorites.favoriteIds}
                onFavorite={favorites.toggleFavorite}
                autoSelected={!uiSettings.defaultAskModelIds.length}
                onAuto={() => void run(() => updateUiSettings({ defaultAskModelIds: [] }), true)}
                onSelect={(mode, id) =>
                  void run(
                    () =>
                      updateUiSettings(
                        mode === 'text'
                          ? { defaultAskModelIds: [id] }
                          : mode === 'image'
                            ? { defaultImageModelId: id }
                            : { defaultVideoModelId: id },
                      ),
                    true,
                  )
                }
              />
            ) : null}
            {dialog.kind === 'api' ? <ProvidersSection theme={theme} /> : null}
            {dialog.kind === 'appearance'
              ? (['auto', 'light', 'dark'] as const).map((value) => (
                  <Button
                    key={value}
                    theme={theme}
                    secondary={appearanceMode === value}
                    disabled={busy}
                    onPress={() => void run(() => setAppearanceMode(value), true)}
                  >
                    {value === 'auto' ? 'System' : value === 'light' ? 'Light' : 'Dark'}
                  </Button>
                ))
              : null}
            {dialog.kind === 'retention'
              ? ([7, 30, 90, 365, 0] as const).map((days) => (
                  <Button
                    key={days}
                    theme={theme}
                    secondary={preferences.transcriptionRetentionDays === days}
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await updatePreferences({ transcriptionRetentionDays: days })
                        await pruneTranscriptionHistory(days)
                        await loadVoice()
                      }, true)
                    }
                  >
                    {days === 0 ? 'Do not keep transcriptions' : `${days} days`}
                  </Button>
                ))
              : null}
          </View>
        </ResourceSheet>
      ) : null}
    </ResourcePage>
  )
}
