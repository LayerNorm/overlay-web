import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, AppState, Linking, NativeModules, Platform } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import * as Notifications from 'expo-notifications'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../contexts/AuthContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useLiveResource } from '../../hooks/useLiveResource'
import { useMobilePreferences } from '../../hooks/useMobilePreferences'
import type { TranscriptionRetentionDays } from '../../services/mobilePreferencesService'
import { api } from '../../services/convexClient'
import { appRequest } from '../../services/appApi'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { saveAccountName } from '../../services/settingsNativeService'
import {
  getAccountDeletionState,
  subscribeAccountDeletion,
} from '../../services/accountDeletionService'
import {
  DEFAULT_BANNER_PREFERENCES,
  loadBannerPreferences,
  saveBannerPreferences,
  type BannerPreferences,
} from '../../services/bannerPreferencesService'
import { requestNotificationPermission } from '../../services/notificationsService'
import {
  clearTranscriptionHistory,
  disableBackgroundVoice,
  enableBackgroundVoice,
  getBackgroundVoiceEnabled,
  getTranscriptionHistory,
  pruneTranscriptionHistory,
} from '../../services/voiceService'
import { SETTINGS_PAGES, SettingsView, type SettingsPage } from './SettingsViews'
import { SETTINGS_EDITORS, SettingsEditorScreen, WebhooksList, type SettingsEditor } from './SettingsEditors'
import { accountPhotoSource } from '../../lib/settingsPhoto'
import { syncPushRegistration } from '../../services/pushRegistrationService'

export default function SettingsScreen() {
  const { activeWorkspaceId } = useWorkspace()
  const { section } = useLocalSearchParams<{ section?: string }>()
  // Editors (memory, invite, API keys, webhooks…) are their own pushed screens.
  const editor = SETTINGS_EDITORS.find((name) => name === section)
  if (editor) return <SettingsEditorScreen key={`${activeWorkspaceId}:${editor}`} editor={editor} />
  return <SettingsScope key={activeWorkspaceId} />
}
function SettingsScope() {
  const { section } = useLocalSearchParams<{ section?: string }>()
  // Each Settings screen shows one page, chosen by its route; sections open
  // as their own pushed screens so back and swipe-back are the system's.
  const page: SettingsPage =
    section === 'push-permission' || SETTINGS_PAGES.some((row) => row[0] === section)
      ? (section as SettingsPage)
      : 'settings'
  const { theme, appearanceMode, setAppearanceMode, isDark } = useTheme()
  const { user, session, signOut } = useAuth()
  const { activeWorkspaceId: workspaceId, activeWorkspace } = useWorkspace()
  const { capabilities, chatModels, uiSettings } = useAppSession()
  const router = useRouter()
  const ready = useNativeDataReady()
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
  const run = async (action: () => Promise<unknown>) => {
    if (working.current || deletion.busy) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (value) {
      if (alive.current && currentScope.current === workspaceId)
        setError(value instanceof Error ? value.message : 'Could not complete this action.')
    } finally {
      working.current = false
      if (alive.current) setBusy(false)
    }
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
      // The account record can lack the provider name and email (it then
      // resolves to "User"); fall back to the signed-in identity, as the
      // server's resolver would, before showing a placeholder.
      displayName:
        profile.data?.displayNameOverride ||
        (profile.data?.email ? profile.data.displayName : '') ||
        [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
        user?.email ||
        'Your account',
      email: profile.data?.email || user?.email || '',
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
  const finishSignOut = async () => {
    await signOut()
    router.replace('/auth-flow')
  }
  const edit = (editor: SettingsEditor, params: Record<string, string> = {}) => {
    if (working.current || deletion.busy) return
    router.push({ pathname: '/settings', params: { section: editor, ...params } })
  }
  const requestPermission = () =>
    void run(async () => {
      const current = await Notifications.getPermissionsAsync()
      if (!current.granted && !current.canAskAgain) {
        await Linking.openSettings()
        return
      }
      const granted = await requestNotificationPermission()
      setPermission(granted ? 'Allowed' : 'Denied · enable in device settings')
      if (granted && user) await syncPushRegistration(user.id)
    })
  return (
    <>
      <SettingsView
        key={page}
        theme={theme}
        page={page}
        data={data}
        webhooks={capabilities.webhooks && workspaceId ? <WebhooksList workspaceId={workspaceId} /> : undefined}
        loading={resource?.loading}
        blocked={Boolean(resource?.error || unavailable)}
        busy={busy || deletion.busy}
        error={resource?.error ?? unavailable ?? (page === 'notifications' ? rooms.error : null) ?? error ?? deletion.error}
        onRetry={resource?.retry}
        actions={{
          room: (conversationId) =>
            edit('room', {
              id: conversationId,
              title: rooms.data?.rooms.find((row) => row._id === conversationId)?.title || 'Conversation',
            }),
          navigate: (next) => {
            if (working.current || deletion.busy) return
            router.push({ pathname: '/settings', params: { section: next } })
          },
          back: () => router.back(),
          memory: (row) => edit('memory', row ? { id: row.memoryId } : {}),
          invite: () => edit('invite'),
          invitation: (row) => edit('member', { id: row.id }),
          connection: (id) => {
            const row = providers.data?.find((item) => item._id === id)
            if (id === 'new-api') edit('add-provider')
            else if (row && row.authKind !== 'subscription') edit('provider', { id: row._id })
            else
              edit('subscription', {
                ...(row ? { id: row._id } : {}),
                ...(row?.subscriptionProvider ? { provider: row.subscriptionProvider } : {}),
              })
          },
          defaultModel: () => edit('default-model'),
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
          retention: (days) => {
            const allowed: TranscriptionRetentionDays[] = [7, 30, 90, 365, 0]
            const choice = allowed.find((value) => value === days)
            if (choice === undefined) return
            void run(async () => {
              await updatePreferences({ transcriptionRetentionDays: choice })
              await pruneTranscriptionHistory(choice)
              await loadVoice()
            })
          },
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
          deleteAccount: () => edit('delete-account'),
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
          appearance: (mode) => {
            if (mode) void run(() => setAppearanceMode(mode))
          },
          permission: requestPermission,
        }}
      />
    </>
  )
}
