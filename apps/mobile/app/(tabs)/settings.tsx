import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import {
  DARK_PRESETS,
  LIGHT_PRESETS,
  type ChatModel,
  type ImageModel,
  type ThemePreset,
  type ThemePresetId,
  type VideoModel,
} from '@overlay/app-core'
import { borderRadius, fontSize, spacing, type Theme } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useMobilePreferences } from '../../hooks/useMobilePreferences'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAuth } from '../../contexts/AuthContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { DrawerSidebar } from '../../components/chat/DrawerSidebar'
import { ScreenWithDrawer } from '../../components/ui/ScreenWithDrawer'
import { BottomSheet, MainScreenHeader, TopBarIconButton } from '../../components/ui/AppChrome'
import {
  ActionRow,
  InfoRow,
  SegmentedControl,
  SettingsSection,
  ToggleRow,
  UsageStat,
  formatCents,
} from '../../components/settings/primitives'
import { ModelsSection } from '../../components/settings/ModelsSection'
import { ProvidersSection } from '../../components/settings/ProvidersSection'
import { WebhooksSection } from '../../components/settings/WebhooksSection'
import { ComputersSection } from '../../components/settings/ComputersSection'
import {
  clearDownloadedFileCache,
  resetMobilePreferences,
  type AppearanceMode,
  type StartDestination,
  type TranscriptionRetentionDays,
} from '../../services/mobilePreferencesService'
import { clearBootstrapCache } from '../../services/bootstrapService'
import { clearUiSettingsCache } from '../../services/settingsService'
import { clearPkceVerifier } from '../../services/authService'
import {
  clearTranscriptionHistory,
  disableBackgroundVoice,
  enableBackgroundVoice,
  getBackgroundVoiceEnabled,
  getMicPermission,
  getTranscriptionHistory,
  pruneTranscriptionHistory,
  type VoicePermission,
} from '../../services/voiceService'
import {
  getBillingSettings,
  updateBillingSettings,
  type BillingSettings,
} from '../../services/billingSettingsService'
import { getTopUpHistory, type TopUpHistoryItem } from '../../services/accountExtrasService'
import { resetOnboarding, clearOnboardingLocalFlag } from '../../services/onboardingService'

const APPEARANCE_OPTIONS: { label: string; value: AppearanceMode }[] = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Auto', value: 'auto' },
]

const START_DESTINATIONS: { label: string; value: StartDestination }[] = [
  { label: 'Last used', value: 'last-used' },
  { label: 'Chat', value: 'chat' },
  { label: 'Agents', value: 'agents' },
  { label: 'Voice', value: 'voice' },
  { label: 'Work', value: 'work' },
  { label: 'Files', value: 'files' },
]

const RETENTION_OPTIONS: { label: string; value: TranscriptionRetentionDays }[] = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '1y', value: 365 },
  { label: 'Off', value: 0 },
]

const IMAGE_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16']
const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1']

type PickerKind = 'act-model' | 'image-model' | 'video-model'

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter()
  const { theme, isDark, appearanceMode, setAppearanceMode } = useTheme()
  const { preferences, updatePreferences } = useMobilePreferences()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const { user, signOut } = useAuth()
  const {
    entitlements,
    uiSettings,
    updateSettings,
    isRefreshing,
    refresh,
    bootstrap,
    chatModels,
    imageModels,
    videoModels,
    featureFlags,
    isFeatureEnabled,
    defaults,
    error: sessionError,
  } = useAppSession()
  const { activeWorkspace, activeWorkspaceId, workspacesEnabled } = useWorkspace()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingSaving, setBillingSaving] = useState(false)
  const [topUpHistory, setTopUpHistory] = useState<TopUpHistoryItem[]>([])
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [voicePermission, setVoicePermission] = useState<VoicePermission>('undetermined')
  const [voiceHistoryCount, setVoiceHistoryCount] = useState(0)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [picker, setPicker] = useState<PickerKind | null>(null)

  const displayName = useMemo(() => {
    if (!user) return 'Overlay account'
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
  }, [user])

  const refreshBilling = useCallback(async () => {
    setBillingLoading(true)
    try {
      setBillingSettings(await getBillingSettings())
    } catch {
      setBillingSettings(null)
    } finally {
      setBillingLoading(false)
    }
    try {
      setTopUpHistory(await getTopUpHistory())
    } catch {
      setTopUpHistory([])
    }
  }, [])

  const refreshVoice = useCallback(async () => {
    const [enabled, permission, history] = await Promise.all([
      getBackgroundVoiceEnabled(),
      getMicPermission(),
      getTranscriptionHistory(),
    ])
    setVoiceEnabled(enabled)
    setVoicePermission(permission)
    setVoiceHistoryCount(history.length)
  }, [])

  useEffect(() => {
    void refreshBilling()
    void refreshVoice()
  }, [refreshBilling, refreshVoice])

  async function handleAppearanceMode(next: AppearanceMode): Promise<void> {
    await setAppearanceMode(next)
    if (next === 'light' || next === 'dark') {
      void updateSettings({ theme: next })
    }
  }

  async function handleVoiceToggle(next: boolean): Promise<void> {
    if (voiceBusy) return
    setVoiceBusy(true)
    try {
      if (next) {
        const result = await enableBackgroundVoice()
        setVoiceEnabled(result.enabled)
        setVoicePermission(result.permission)
        if (!result.enabled && result.permission !== 'granted') {
          Alert.alert('Microphone access needed', 'Open iOS Settings and allow microphone access for Overlay.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ])
        }
      } else {
        await disableBackgroundVoice()
        setVoiceEnabled(false)
      }
    } finally {
      setVoiceBusy(false)
    }
  }

  async function handleRetentionChange(value: TranscriptionRetentionDays): Promise<void> {
    await updatePreferences({ transcriptionRetentionDays: value })
    await pruneTranscriptionHistory(value)
    await refreshVoice()
  }

  async function handleBillingToggle(autoTopUpEnabled: boolean): Promise<void> {
    if (!billingSettings || billingSettings.planKind !== 'paid') return
    setBillingSaving(true)
    try {
      await updateBillingSettings({
        autoTopUpEnabled,
        topUpAmountCents: billingSettings.topUpAmountCents,
        grantOffSessionConsent: autoTopUpEnabled,
      })
      await refreshBilling()
      void refresh({ forceRefresh: true })
    } finally {
      setBillingSaving(false)
    }
  }

  async function handleBillingAmount(topUpAmountCents: number): Promise<void> {
    if (!billingSettings || billingSettings.planKind !== 'paid') return
    setBillingSaving(true)
    try {
      await updateBillingSettings({
        autoTopUpEnabled: billingSettings.autoTopUpEnabled,
        topUpAmountCents,
        grantOffSessionConsent: billingSettings.autoTopUpEnabled,
      })
      await refreshBilling()
      void refresh({ forceRefresh: true })
    } finally {
      setBillingSaving(false)
    }
  }

  async function handleSignOut(): Promise<void> {
    if (isSigningOut) return

    setIsSigningOut(true)
    try {
      await signOut()
      router.replace('/auth-flow?mode=sign-in&force=true')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sign out.'
      Alert.alert('Sign out failed', message)
    } finally {
      setIsSigningOut(false)
    }
  }

  function handleDeleteAccount(): void {
    Alert.alert(
      'Delete account',
      'This permanently deletes your Overlay account, chats, notes, knowledge, and saved memories. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue to delete',
          style: 'destructive',
          onPress: () => {
            void Linking.openURL('https://www.getoverlay.io/account?delete=1')
          },
        },
      ],
    )
  }

  function handleClearTranscriptions(): void {
    Alert.alert('Clear transcriptions', 'Remove all saved keyboard dictation history from this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearTranscriptionHistory()
          await refreshVoice()
        },
      },
    ])
  }

  function handleClearCaches(): void {
    Alert.alert('Clear local caches', 'This clears cached bootstrap data, synced settings cache, and downloaded file cache on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await Promise.allSettled([
            clearBootstrapCache(),
            clearUiSettingsCache(),
            clearDownloadedFileCache(),
          ])
          void refresh({ forceRefresh: true })
        },
      },
    ])
  }

  async function handleResetDevicePreferences(): Promise<void> {
    await resetMobilePreferences()
  }

  async function handleReplayOnboarding(): Promise<void> {
    const userId = user?.id
    if (!userId) return
    try {
      await resetOnboarding()
    } catch {
      // Server reset is best-effort; the local flag still re-arms the flow.
    }
    await clearOnboardingLocalFlag(userId)
    router.push('/onboarding')
  }

  const activeChatModel = findById(chatModels, uiSettings.defaultActModelId ?? defaults?.chatModelId)
  const activeImageModel = findById(imageModels, uiSettings.defaultImageModelId ?? defaults?.imageModelId)
  const activeVideoModel = findById(videoModels, uiSettings.defaultVideoModelId ?? defaults?.videoModelId)

  return (
    <ScreenWithDrawer
      drawer={
        <DrawerSidebar
          variant="slide"
          theme={theme}
          chats={[]}
          activeChatId={null}
          onSelectChat={() => {}}
          onCreateChat={() => {}}
        />
      }
    >
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          blurHeight={insets.top + 56}
          leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
          centerSlot={<Text style={[styles.headerTitle, { color: theme.text }]}>Settings</Text>}
          rightSlot={<TopBarIconButton theme={theme} icon="refresh-cw" onPress={() => { void refresh({ forceRefresh: true }); void refreshBilling(); void refreshVoice() }} />}
        />
        <ScrollView
          style={styles.screenScroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.screenPadding, { paddingTop: insets.top + 58 }]}
        >
          <View style={styles.content}>
            <SettingsSection theme={theme} title="Account" icon="user">
              <InfoRow theme={theme} label="Signed in" value={displayName} />
              <InfoRow theme={theme} label="Email" value={user?.email ?? 'Not available'} />
              <InfoRow theme={theme} label="Email status" value={user?.emailVerified ? 'Verified' : 'Unverified'} />
              <ActionRow
                theme={theme}
                icon="log-out"
                title="Sign out"
                detail="Clear the active session and sensitive device caches."
                onPress={() => { void handleSignOut() }}
                busy={isSigningOut}
              />
            </SettingsSection>

            {workspacesEnabled ? (
              <SettingsSection theme={theme} title="Workspace" icon="briefcase">
                <InfoRow
                  theme={theme}
                  label="Active workspace"
                  value={activeWorkspace?.name ?? 'Personal'}
                />
                <ActionRow
                  theme={theme}
                  icon="users"
                  title="Manage workspace"
                  detail="People, teams, sharing, billing, and imports."
                  onPress={() => router.push('/(tabs)/workspace')}
                />
              </SettingsSection>
            ) : null}

            <SettingsSection
              theme={theme}
              title="Plan & Usage"
              icon="credit-card"
              accessory={isRefreshing || billingLoading ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
            >
              {entitlements ? (
                <>
                  <View style={styles.usageGrid}>
                    <UsageStat theme={theme} label="Tier" value={entitlements.tier.toUpperCase()} />
                    <UsageStat theme={theme} label="Remaining" value={formatCents(entitlements.budgetRemainingCents ?? 0)} />
                    <UsageStat theme={theme} label="Storage" value={formatBytes(entitlements.overlayStorageBytesUsed ?? 0)} />
                  </View>
                  <View style={styles.usageGrid}>
                    <UsageStat theme={theme} label="Budget" value={formatCents(entitlements.budgetTotalCents ?? entitlements.creditsTotal)} />
                    <UsageStat theme={theme} label="Used" value={formatCents(entitlements.budgetUsedCents ?? entitlements.creditsUsed)} />
                    <UsageStat theme={theme} label="Voice" value={formatSeconds(entitlements.transcriptionSecondsUsed ?? 0)} />
                  </View>
                  {billingSettings?.planKind === 'paid' ? (
                    <>
                      <ToggleRow
                        theme={theme}
                        title="Auto top-up"
                        detail="Use saved billing consent to recharge when your Overlay budget reaches zero."
                        value={billingSettings.autoTopUpEnabled}
                        onValueChange={(value) => { void handleBillingToggle(value) }}
                        disabled={billingSaving}
                      />
                      <SegmentedControl
                        theme={theme}
                        value={String(billingSettings.topUpAmountCents)}
                        options={buildTopUpOptions(billingSettings).map((amount) => ({
                          label: formatCents(amount),
                          value: String(amount),
                        }))}
                        onChange={(value) => { void handleBillingAmount(Number(value)) }}
                        disabled={billingSaving}
                      />
                    </>
                  ) : (
                    <Text style={[styles.helperText, { color: theme.textSecondary }]}>
                      Paid entitlements and top-up preferences display here when enabled on your account.
                    </Text>
                  )}
                  {topUpHistory.length > 0 ? (
                    <>
                      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Top-up history</Text>
                      {topUpHistory.slice(0, 5).map((item) => (
                        <InfoRow
                          key={item._id}
                          theme={theme}
                          label={new Date(item.createdAt).toLocaleDateString()}
                          value={`${formatCents(item.amountCents)} · ${item.status}${item.source === 'auto' ? ' · auto' : ''}`}
                        />
                      ))}
                    </>
                  ) : null}
                  <Text style={[styles.helperText, { color: theme.textSecondary }]}>
                    Checkout and the billing portal stay on the web app — purchases aren't offered
                    inside the mobile app.
                  </Text>
                </>
              ) : (
                <Text style={[styles.helperText, { color: theme.textSecondary }]}>Subscription state will appear after refresh.</Text>
              )}
            </SettingsSection>

            <SettingsSection theme={theme} title="Appearance" icon="moon">
              <SegmentedControl
                theme={theme}
                value={appearanceMode}
                options={APPEARANCE_OPTIONS}
                onChange={(value) => { void handleAppearanceMode(value as AppearanceMode) }}
              />
              <ThemePresetPicker
                theme={theme}
                label="Light theme"
                presets={LIGHT_PRESETS}
                value={uiSettings.lightThemePreset}
                onChange={(lightThemePreset) => { void updateSettings({ lightThemePreset }) }}
              />
              <ThemePresetPicker
                theme={theme}
                label="Dark theme"
                presets={DARK_PRESETS}
                value={uiSettings.darkThemePreset}
                onChange={(darkThemePreset) => { void updateSettings({ darkThemePreset }) }}
              />
            </SettingsSection>

            <SettingsSection theme={theme} title="Chat Defaults" icon="message-square">
              <ActionRow
                theme={theme}
                icon="cpu"
                title="Default model"
                detail={activeChatModel?.name ?? 'Backend default'}
                onPress={() => setPicker('act-model')}
              />
              <ToggleRow
                theme={theme}
                title="Auto-continue"
                detail="Resume long assistant runs when the backend supports it."
                value={uiSettings.autoContinue}
                onValueChange={(autoContinue) => { void updateSettings({ autoContinue }) }}
              />
              <ToggleRow
                theme={theme}
                title="Send with Enter"
                detail="Use Enter as the quick-send behavior where a hardware keyboard is attached."
                value={uiSettings.sendWithEnter}
                onValueChange={(sendWithEnter) => { void updateSettings({ sendWithEnter }) }}
              />
              <ToggleRow
                theme={theme}
                title="Index attachments by default"
                detail="Send document attachments through backend ingestion before chat when supported."
                value={uiSettings.attachFilesToKnowledgeByDefault}
                onValueChange={(attachFilesToKnowledgeByDefault) => { void updateSettings({ attachFilesToKnowledgeByDefault }) }}
              />
            </SettingsSection>

            <SettingsSection theme={theme} title="Generation Defaults" icon="image">
              <ActionRow
                theme={theme}
                icon="image"
                title="Image model"
                detail={activeImageModel?.name ?? 'Backend default'}
                onPress={() => setPicker('image-model')}
              />
              <SegmentedControl
                theme={theme}
                value={uiSettings.defaultImageAspectRatio ?? '1:1'}
                options={IMAGE_ASPECT_RATIOS.map((ratio) => ({ label: ratio, value: ratio }))}
                onChange={(defaultImageAspectRatio) => { void updateSettings({ defaultImageAspectRatio }) }}
              />
              <ActionRow
                theme={theme}
                icon="video"
                title="Video model"
                detail={activeVideoModel?.name ?? 'Backend default'}
                onPress={() => setPicker('video-model')}
              />
              <SegmentedControl
                theme={theme}
                value={uiSettings.defaultVideoAspectRatio ?? '16:9'}
                options={VIDEO_ASPECT_RATIOS.map((ratio) => ({ label: ratio, value: ratio }))}
                onChange={(defaultVideoAspectRatio) => { void updateSettings({ defaultVideoAspectRatio }) }}
              />
            </SettingsSection>

            <ModelsSection
              theme={theme}
              chatModels={chatModels}
              enabledChatModelIds={uiSettings.enabledChatModelIds}
              onSettingsChange={updateSettings}
            />

            <SettingsSection theme={theme} title="Voice & Keyboard" icon="mic">
              <ToggleRow
                theme={theme}
                title="Background voice"
                detail={`Microphone permission: ${voicePermission}`}
                value={voiceEnabled}
                onValueChange={(value) => { void handleVoiceToggle(value) }}
                disabled={voiceBusy}
              />
              <ToggleRow
                theme={theme}
                title="Haptics"
                detail="Use subtle native feedback for chat and controls."
                value={preferences.hapticsEnabled}
                onValueChange={(hapticsEnabled) => { void updatePreferences({ hapticsEnabled }) }}
              />
              {/* Convex-native in Phase 1: notification preferences. */}
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Transcription retention</Text>
              <SegmentedControl
                theme={theme}
                value={String(preferences.transcriptionRetentionDays)}
                options={RETENTION_OPTIONS.map((option) => ({ label: option.label, value: String(option.value) }))}
                onChange={(value) => { void handleRetentionChange(Number(value) as TranscriptionRetentionDays) }}
              />
              <ActionRow
                theme={theme}
                icon="trash-2"
                title="Clear transcription history"
                detail={`${voiceHistoryCount} saved on this device`}
                onPress={handleClearTranscriptions}
                destructive
              />
            </SettingsSection>

            <SettingsSection theme={theme} title="Data & Privacy" icon="shield">
              <ActionRow theme={theme} icon="database" title="Files" detail="Files, notes, and outputs." onPress={() => router.push('/(tabs)/files')} />
              <ActionRow theme={theme} icon="bookmark" title="Manage memories" detail="Review, edit, and delete saved memories." onPress={() => router.push('/memories')} />
              <ActionRow theme={theme} icon="trash" title="Clear local caches" detail="Bootstrap, settings cache, and downloaded files." onPress={handleClearCaches} destructive />
              <ActionRow theme={theme} icon="key" title="Clear auth handoff residue" detail="Remove pending PKCE handoff without signing out." onPress={() => { void clearPkceVerifier() }} />
              <ActionRow theme={theme} icon="external-link" title="Privacy policy" detail="Open Overlay privacy policy." onPress={() => { void Linking.openURL('https://www.getoverlay.io/privacy') }} />
              <ActionRow theme={theme} icon="external-link" title="Terms of service" detail="Open Overlay terms." onPress={() => { void Linking.openURL('https://www.getoverlay.io/terms') }} />
              <ActionRow theme={theme} icon="trash-2" title="Delete account" detail="Permanently remove your Overlay account and data." onPress={handleDeleteAccount} destructive />
            </SettingsSection>

            <SettingsSection theme={theme} title="Extensions & Integrations" icon="grid">
              {isFeatureEnabled('extensions') && <ActionRow theme={theme} icon="tool" title="Manage extensions" detail={featureFlags.canUseExtensions ? 'Integrations, skills, and MCPs.' : 'Unavailable on this account.'} onPress={() => router.push('/(tabs)/tools')} />}
              <ActionRow theme={theme} icon="zap" title="Manage automations" detail={featureFlags.canUseAutomations ? 'Scheduled backend workflows.' : 'Unavailable on this account.'} onPress={() => router.push('/(tabs)/automations')} />
            </SettingsSection>

            <ProvidersSection theme={theme} />

            <WebhooksSection theme={theme} />

            {activeWorkspaceId ? (
              <ComputersSection theme={theme} workspaceId={activeWorkspaceId} userId={user?.id ?? null} />
            ) : null}

            <SettingsSection theme={theme} title="Contact" icon="mail">
              <ActionRow
                theme={theme}
                icon="mail"
                title="Email the founder"
                detail={bootstrap?.brand?.supportEmail ?? 'divyansh@layernorm.co'}
                onPress={() => {
                  void Linking.openURL(
                    `mailto:${bootstrap?.brand?.supportEmail ?? 'divyansh@layernorm.co'}`,
                  )
                }}
              />
            </SettingsSection>

            <SettingsSection theme={theme} title="Advanced" icon="settings">
              <SegmentedControl
                theme={theme}
                value={preferences.startDestination}
                options={START_DESTINATIONS}
                onChange={(startDestination) => { void updatePreferences({ startDestination: startDestination as StartDestination }) }}
              />
              <ToggleRow
                theme={theme}
                title="Show diagnostics"
                detail="Reveal backend/session errors and local state details."
                value={preferences.showAdvancedDiagnostics}
                onValueChange={(showAdvancedDiagnostics) => { void updatePreferences({ showAdvancedDiagnostics }) }}
              />
              {preferences.showAdvancedDiagnostics ? (
                <View style={[styles.diagnosticsBox, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                  <Text selectable style={[styles.diagnosticsText, { color: theme.textSecondary }]}>User: {user?.id ?? 'signed-out'}</Text>
                  <Text selectable style={[styles.diagnosticsText, { color: theme.textSecondary }]}>Session error: {sessionError ?? 'none'}</Text>
                  <Text selectable style={[styles.diagnosticsText, { color: theme.textSecondary }]}>Voice: {voiceEnabled ? 'enabled' : 'disabled'} / {voicePermission}</Text>
                </View>
              ) : null}
              <ActionRow theme={theme} icon="rotate-ccw" title="Reset device preferences" detail="Keep account data, reset local-only choices." onPress={() => { void handleResetDevicePreferences() }} />
              <ActionRow theme={theme} icon="play-circle" title="Replay onboarding" detail="Reset the first-run tour and show it again." onPress={() => { void handleReplayOnboarding() }} />
            </SettingsSection>
          </View>
        </ScrollView>

        <ModelPickerSheet
          theme={theme}
          picker={picker}
          chatModels={chatModels}
          imageModels={imageModels}
          videoModels={videoModels}
          selectedActModelId={uiSettings.defaultActModelId}
          selectedImageModelId={uiSettings.defaultImageModelId}
          selectedVideoModelId={uiSettings.defaultVideoModelId}
          isFreeTier={entitlements?.tier === 'free'}
          onClose={() => setPicker(null)}
          onSelectAct={(defaultActModelId) => { void updateSettings({ defaultActModelId }); setPicker(null) }}
          onSelectImage={(defaultImageModelId) => { void updateSettings({ defaultImageModelId }); setPicker(null) }}
          onSelectVideo={(defaultVideoModelId) => { void updateSettings({ defaultVideoModelId }); setPicker(null) }}
        />
      </SafeAreaView>
    </ScreenWithDrawer>
  )
}

function ThemePresetPicker({
  theme,
  label,
  presets,
  value,
  onChange,
}: {
  theme: Theme
  label: string
  presets: readonly ThemePreset[]
  value: ThemePresetId
  onChange: (value: ThemePresetId) => void
}): React.ReactElement {
  return (
    <View style={styles.presetGroup}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetList}>
        {presets.map((preset) => {
          const active = preset.id === value
          return (
            <TouchableOpacity
              key={preset.id}
              activeOpacity={0.82}
              onPress={() => onChange(preset.id)}
              style={[
                styles.presetChip,
                {
                  backgroundColor: active ? theme.surfaceSubtle : theme.surfaceElevated,
                  borderColor: active ? theme.foreground : theme.border,
                },
              ]}
            >
              <View
                style={[
                  styles.presetSwatch,
                  {
                    backgroundColor: preset.previewColors.background,
                    borderColor: active ? theme.foreground : theme.border,
                  },
                ]}
              >
                <View style={[styles.presetSwatchAccent, { backgroundColor: preset.previewColors.accent }]} />
              </View>
              <Text numberOfLines={1} style={[styles.presetChipLabel, { color: active ? theme.text : theme.textSecondary }]}>
                {preset.name}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

function ModelPickerSheet({
  theme,
  picker,
  chatModels,
  imageModels,
  videoModels,
  selectedActModelId,
  selectedImageModelId,
  selectedVideoModelId,
  isFreeTier,
  onClose,
  onSelectAct,
  onSelectImage,
  onSelectVideo,
}: {
  theme: Theme
  picker: PickerKind | null
  chatModels: ChatModel[]
  imageModels: ImageModel[]
  videoModels: VideoModel[]
  selectedActModelId?: string
  selectedImageModelId?: string
  selectedVideoModelId?: string
  isFreeTier: boolean
  onClose: () => void
  onSelectAct: (modelId: string) => void
  onSelectImage: (modelId: string) => void
  onSelectVideo: (modelId: string) => void
}): React.ReactElement {
  const title =
    picker === 'act-model'
      ? 'Default Model'
      : picker === 'image-model'
        ? 'Default Image Model'
        : 'Default Video Model'
  const rows =
    picker === 'image-model'
      ? imageModels
      : picker === 'video-model'
        ? videoModels
        : chatModels

  return (
    <BottomSheet theme={theme} visible={picker !== null} onClose={onClose} title={title}>
      <View style={styles.sheetRows}>
        {rows.length === 0 ? (
          <Text style={[styles.helperText, { color: theme.textSecondary }]}>Models will appear after app bootstrap refreshes.</Text>
        ) : rows.map((model) => {
          const selected =
            picker === 'act-model'
              ? selectedActModelId === model.id
              : picker === 'image-model'
                ? selectedImageModelId === model.id
                : selectedVideoModelId === model.id
          return (
            <TouchableOpacity
              key={model.id}
              activeOpacity={0.82}
              onPress={() => {
                if (
                  picker === 'act-model' &&
                  isFreeTier &&
                  'cost' in model &&
                  model.cost > 0
                ) {
                  Alert.alert('Premium model', 'Free accounts can save only free models as mobile chat defaults.')
                  return
                }
                if (picker === 'act-model') onSelectAct(model.id)
                else if (picker === 'image-model') onSelectImage(model.id)
                else onSelectVideo(model.id)
              }}
              style={[styles.modelRow, { borderColor: theme.border }]}
            >
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>{model.name}</Text>
                {'provider' in model && model.provider ? (
                  <Text style={[styles.rowDetail, { color: theme.textSecondary }]}>
                    {model.provider}
                    {picker === 'act-model' && isFreeTier && 'cost' in model && model.cost > 0
                      ? ' · Premium'
                      : ''}
                  </Text>
                ) : null}
              </View>
              {selected ? <Feather name="check" size={18} color={theme.text} /> : null}
            </TouchableOpacity>
          )
        })}
      </View>
    </BottomSheet>
  )
}

function findById<T extends { id: string }>(items: T[], id?: string): T | undefined {
  if (!id) return undefined
  return items.find((item) => item.id === id)
}

function buildTopUpOptions(settings: BillingSettings): number[] {
  const options: number[] = []
  for (
    let amount = settings.topUpMinAmountCents;
    amount <= settings.topUpMaxAmountCents;
    amount += settings.topUpStepAmountCents
  ) {
    options.push(amount)
    if (options.length >= 5) break
  }
  if (!options.includes(settings.topUpAmountCents)) options.push(settings.topUpAmountCents)
  return options.sort((a, b) => a - b)
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatSeconds(value: number): string {
  if (value < 60) return `${Math.round(value)}s`
  return `${Math.round(value / 60)}m`
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screenPadding: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  screenScroll: {
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    textAlign: 'center',
  },
  content: {
    gap: spacing.md,
    paddingTop: spacing.lg,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    lineHeight: 24,
    fontWeight: '700',
  },
  sectionAccessory: {
    minWidth: 24,
    alignItems: 'flex-end',
  },
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowCopy: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: fontSize.md,
    lineHeight: 20,
    fontWeight: '600',
  },
  rowDetail: {
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  helperText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  infoLabel: {
    width: 92,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 34,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  usageGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  usageStat: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 4,
  },
  usageLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  usageValue: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  presetGroup: {
    gap: spacing.sm,
  },
  presetList: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  presetChip: {
    width: 124,
    minHeight: 80,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  presetSwatch: {
    height: 34,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'flex-end',
    padding: 6,
  },
  presetSwatchAccent: {
    width: 28,
    height: 8,
    borderRadius: borderRadius.full,
  },
  presetChipLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  diagnosticsBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 4,
  },
  diagnosticsText: {
    fontSize: fontSize.xs,
    lineHeight: 17,
  },
  sheetRows: {
    gap: spacing.sm,
  },
  modelRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
})
