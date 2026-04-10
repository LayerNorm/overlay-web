import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Audio } from 'expo-av'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../contexts/AuthContext'
import { AuthPanel } from '../../components/auth/AuthPanel'
import { getAppBootstrap } from '../../services/bootstrapService'
import type { AppBootstrap } from '../../services/appContracts'

type SettingsTab = 'account' | 'general' | 'models' | 'voice' | 'about'

const APP_VERSION = '1.0.0'
const SOURCE_CODE_URL = 'https://github.com/DevelopedByDev/overlay'
const CONTACT_URL = 'https://www.getoverlay.ai'

const SETTINGS_TABS: Array<{
  id: SettingsTab
  label: string
  description: string
  icon: keyof typeof Feather.glyphMap
}> = [
  {
    id: 'account',
    label: 'Account',
    description: 'Sign in, plan, and credits',
    icon: 'user',
  },
  {
    id: 'general',
    label: 'General',
    description: 'Appearance and sync behavior',
    icon: 'settings',
  },
  {
    id: 'models',
    label: 'Models',
    description: 'Server-backed model catalog',
    icon: 'cpu',
  },
  {
    id: 'voice',
    label: 'Voice',
    description: 'Microphone and hosted transcription',
    icon: 'mic',
  },
  {
    id: 'about',
    label: 'About',
    description: 'Build info and links',
    icon: 'info',
  },
]

function SidebarItem({
  id,
  label,
  description,
  icon,
  isActive,
  isCompact,
  onPress,
}: {
  id: SettingsTab
  label: string
  description: string
  icon: keyof typeof Feather.glyphMap
  isActive: boolean
  isCompact: boolean
  onPress: (id: SettingsTab) => void
}): React.ReactElement {
  const { theme, isDark } = useTheme()
  const activeBackground = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)'

  return (
    <TouchableOpacity
      onPress={() => onPress(id)}
      activeOpacity={0.82}
      style={[
        styles.sidebarItem,
        isCompact ? styles.sidebarItemCompact : styles.sidebarItemRail,
        { backgroundColor: isActive ? activeBackground : 'transparent' },
      ]}
    >
      {!isCompact && isActive ? (
        <View style={[styles.sidebarIndicator, { backgroundColor: theme.text }]} />
      ) : null}
      <Feather name={icon} size={18} color={isActive ? theme.text : theme.textSecondary} />
      <View style={styles.sidebarTextWrap}>
        <Text style={[styles.sidebarLabel, { color: isActive ? theme.text : theme.textSecondary }]}>
          {label}
        </Text>
        {!isCompact ? (
          <Text style={[styles.sidebarDescription, { color: theme.textDisabled }]}>{description}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  )
}

function SettingsPanel({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  children: React.ReactNode
}): React.ReactElement {
  const { theme } = useTheme()

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.panelHeader}>
        <Text style={[styles.panelEyebrow, { color: theme.textSecondary }]}>{eyebrow}</Text>
        <Text style={[styles.panelTitle, { color: theme.text }]}>{title}</Text>
        {description ? (
          <Text style={[styles.panelDescription, { color: theme.textSecondary }]}>{description}</Text>
        ) : null}
      </View>
      <View style={styles.panelBody}>{children}</View>
    </View>
  )
}

function SettingsRow({
  icon,
  title,
  description,
  onPress,
  rightElement,
  isLast = false,
}: {
  icon: keyof typeof Feather.glyphMap
  title: string
  description?: string
  onPress?: () => void
  rightElement?: React.ReactNode
  isLast?: boolean
}): React.ReactElement {
  const { theme } = useTheme()

  return (
    <TouchableOpacity
      style={[
        styles.settingsRow,
        {
          borderBottomColor: isLast ? 'transparent' : theme.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={onPress ? 0.72 : 1}
      disabled={!onPress}
    >
      <View style={styles.settingsRowLeft}>
        <View style={[styles.rowIconWrap, { backgroundColor: theme.background }]}>
          <Feather name={icon} size={16} color={theme.textSecondary} />
        </View>
        <View style={styles.settingsRowText}>
          <Text style={[styles.settingsRowTitle, { color: theme.text }]}>{title}</Text>
          {description ? (
            <Text style={[styles.settingsRowDescription, { color: theme.textSecondary }]}>
              {description}
            </Text>
          ) : null}
        </View>
      </View>
      {rightElement || (onPress ? <Feather name="chevron-right" size={18} color={theme.textSecondary} /> : null)}
    </TouchableOpacity>
  )
}

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter()
  const { tab } = useLocalSearchParams<{ tab?: SettingsTab }>()
  const { theme, isDark, toggleTheme } = useTheme()
  const { width } = useWindowDimensions()
  const { entitlements } = useAuth()
  const [activeTab, setActiveTab] = useState<SettingsTab>(tab && SETTINGS_TABS.some((item) => item.id === tab) ? tab : 'account')
  const [micPermission, setMicPermission] = useState<'undetermined' | 'granted' | 'denied'>('undetermined')
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null)

  const isRailLayout = width >= 720

  useEffect(() => {
    Audio.getPermissionsAsync().then(({ status }) => {
      setMicPermission(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined')
    })

    getAppBootstrap()
      .then(setBootstrap)
      .catch(() => {
        setBootstrap(null)
      })
  }, [])

  useEffect(() => {
    if (tab && SETTINGS_TABS.some((item) => item.id === tab)) {
      setActiveTab(tab)
    }
  }, [tab])

  const requestMicPermission = useCallback(async () => {
    const { status } = await Audio.requestPermissionsAsync()
    const next = status === 'granted' ? 'granted' : 'denied'
    setMicPermission(next)

    if (next === 'denied') {
      Alert.alert(
        'Microphone Access Denied',
        'Enable microphone access in system settings to use hosted voice transcription.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openURL('app-settings:') },
        ],
      )
    }
  }, [])

  const activeTabMeta = SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0]
  const featureFlags = bootstrap?.featureFlags

  const modelSummary = useMemo(
    () => ({
      chat: bootstrap?.chatModels.length ?? 0,
      image: bootstrap?.imageModels.length ?? 0,
      video: bootstrap?.videoModels.length ?? 0,
    }),
    [bootstrap],
  )

  const renderContent = (): React.ReactElement => {
    switch (activeTab) {
      case 'account':
        return (
          <View style={styles.contentStack}>
            <SettingsPanel
              eyebrow="Account"
              title="Overlay Identity"
              description="Mobile now relies on the same hosted auth and entitlements as the web app."
            >
              <AuthPanel
                context="settings"
                onSignedOut={() => router.replace('/onboarding?startAtAuth=true')}
              />
            </SettingsPanel>
          </View>
        )

      case 'general':
        return (
          <View style={styles.contentStack}>
            <SettingsPanel
              eyebrow="General"
              title="Appearance"
              description="Theme and app behavior are synced through Overlay settings."
            >
              <SettingsRow
                icon="moon"
                title="Dark Mode"
                description="Uses the same server-backed theme preference as the web app."
                isLast
                rightElement={
                  <Switch
                    value={isDark}
                    onValueChange={toggleTheme}
                    trackColor={{ false: theme.toggleBg, true: theme.toggleBgActive }}
                    thumbColor={theme.toggleThumb}
                  />
                }
              />
            </SettingsPanel>

            <SettingsPanel
              eyebrow="Sync"
              title="Parity Defaults"
              description="The mobile shell is adapted for touch, but product state now comes from the web-side Overlay APIs."
            >
              <SettingsRow
                icon="refresh-cw"
                title="Data Source"
                description="Chats, notes, settings, outputs, and entitlements sync from Overlay."
              />
              <SettingsRow
                icon="hard-drive"
                title="Offline Cache"
                description="Local storage is used for session restore, cached bootstrap data, and draft resume only."
                isLast
              />
            </SettingsPanel>
          </View>
        )

      case 'models':
        return (
          <View style={styles.contentStack}>
            <SettingsPanel
              eyebrow="Models"
              title="Server Catalog"
              description="The model picker now comes from the same canonical catalog used by the web app."
            >
              <SettingsRow
                icon="message-square"
                title="Chat Models"
                description={`${modelSummary.chat} synced model${modelSummary.chat === 1 ? '' : 's'} available`}
              />
              <SettingsRow
                icon="image"
                title="Image Models"
                description={`${modelSummary.image} image generator${modelSummary.image === 1 ? '' : 's'}`}
              />
              <SettingsRow
                icon="video"
                title="Video Models"
                description={`${modelSummary.video} video generator${modelSummary.video === 1 ? '' : 's'}`}
                isLast
              />
            </SettingsPanel>

            <SettingsPanel
              eyebrow="Entitlements"
              title="Access Control"
              description="Free and paid model access is enforced by Overlay APIs instead of device-local provider keys."
            >
              <SettingsRow
                icon="shield"
                title="Current Tier"
                description={entitlements ? entitlements.tier.toUpperCase() : 'Signed-out or still syncing'}
              />
              <SettingsRow
                icon="zap"
                title="Credits"
                description={
                  entitlements
                    ? `${entitlements.creditsUsed} / ${entitlements.creditsTotal} used`
                    : 'Credits load with your account session'
                }
                isLast
              />
            </SettingsPanel>
          </View>
        )

      case 'voice':
        return (
          <View style={styles.contentStack}>
            <SettingsPanel
              eyebrow="Voice"
              title="Hosted Transcription"
              description="Voice input sends audio to Overlay transcription endpoints instead of direct device-side provider keys."
            >
              <SettingsRow
                icon={micPermission === 'granted' ? 'check-circle' : 'mic'}
                title="Microphone Access"
                description={
                  micPermission === 'granted'
                    ? 'Granted'
                    : micPermission === 'denied'
                      ? 'Denied. Tap to open system settings.'
                      : 'Tap to grant microphone permission.'
                }
                onPress={micPermission === 'granted' ? undefined : requestMicPermission}
                rightElement={
                  <View
                    style={[
                      styles.permissionPill,
                      {
                        backgroundColor:
                          micPermission === 'granted'
                            ? 'rgba(16, 185, 129, 0.12)'
                            : 'rgba(239, 68, 68, 0.12)',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.permissionPillText,
                        { color: micPermission === 'granted' ? '#10B981' : '#EF4444' },
                      ]}
                    >
                      {micPermission === 'granted' ? 'Ready' : 'Needs Setup'}
                    </Text>
                  </View>
                }
              />
              <SettingsRow
                icon="radio"
                title="Voice Feature Flag"
                description={featureFlags?.canUseVoiceTranscription ? 'Enabled for this account' : 'Not enabled for this account'}
                isLast
              />
            </SettingsPanel>
          </View>
        )

      case 'about':
      default:
        return (
          <View style={styles.contentStack}>
            <SettingsPanel
              eyebrow="About"
              title="Build Info"
              description="Version details and external links."
            >
              <SettingsRow icon="box" title="Version" description={APP_VERSION} />
              <SettingsRow
                icon="github"
                title="Source Code"
                description="View the Overlay repository."
                onPress={() => Linking.openURL(SOURCE_CODE_URL)}
              />
              <SettingsRow
                icon="life-buoy"
                title="Contact"
                description="Open the main Overlay site."
                onPress={() => Linking.openURL(CONTACT_URL)}
                isLast
              />
            </SettingsPanel>
          </View>
        )
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerEyebrow, { color: theme.textSecondary }]}>Settings</Text>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{activeTabMeta.label}</Text>
        <Text style={[styles.headerDescription, { color: theme.textSecondary }]}>
          {activeTabMeta.description}
        </Text>
      </View>

      <View style={[styles.body, { flexDirection: isRailLayout ? 'row' : 'column' }]}>
        {isRailLayout ? (
          <View style={[styles.sidebarRail, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {SETTINGS_TABS.map((tab) => (
              <SidebarItem
                key={tab.id}
                id={tab.id}
                label={tab.label}
                description={tab.description}
                icon={tab.icon}
                isActive={activeTab === tab.id}
                isCompact={false}
                onPress={setActiveTab}
              />
            ))}
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.compactSidebarContent}
            style={styles.compactSidebarScroll}
          >
            {SETTINGS_TABS.map((tab) => (
              <SidebarItem
                key={tab.id}
                id={tab.id}
                label={tab.label}
                description={tab.description}
                icon={tab.icon}
                isActive={activeTab === tab.id}
                isCompact
                onPress={setActiveTab}
              />
            ))}
          </ScrollView>
        )}

        <ScrollView
          style={styles.contentScroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.contentScrollInner, !isRailLayout && styles.contentScrollInnerCompact]}
        >
          {renderContent()}
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  headerEyebrow: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 6,
  },
  headerDescription: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  body: {
    flex: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  sidebarRail: {
    width: 280,
    borderWidth: 1,
    borderRadius: 24,
    padding: spacing.sm,
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  compactSidebarScroll: {
    flexGrow: 0,
  },
  compactSidebarContent: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 18,
  },
  sidebarItemRail: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sidebarItemCompact: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  sidebarIndicator: {
    width: 3,
    height: 18,
    borderRadius: 999,
  },
  sidebarTextWrap: {
    flex: 1,
    gap: 2,
  },
  sidebarLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  sidebarDescription: {
    fontSize: fontSize.xs,
    lineHeight: 18,
  },
  contentScroll: {
    flex: 1,
  },
  contentScrollInner: {
    paddingBottom: spacing.xl,
  },
  contentScrollInnerCompact: {
    paddingTop: spacing.md,
  },
  contentStack: {
    gap: spacing.lg,
  },
  panel: {
    borderWidth: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  panelHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: 4,
  },
  panelEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  panelTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  panelDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  panelBody: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  settingsRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
  },
  settingsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  rowIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsRowText: {
    flex: 1,
    gap: 3,
  },
  settingsRowTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  settingsRowDescription: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  permissionPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  permissionPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
})
