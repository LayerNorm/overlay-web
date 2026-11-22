import React, { useState } from 'react'
import { Image, Pressable, Switch, TextInput, View } from 'react-native'
import {
  Bell,
  BookOpen,
  Sparkles,
  Bot,
  CircleHelp,
  CreditCard,
  ExternalLink,
  Mail,
  Mic,
  MoreHorizontal,
  Plus,
  Settings,
  Shield,
  Trash2,
  User,
  Users,
  Webhook,
  Zap,
} from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { AgentAvatar } from '../shell/AgentAvatar'
import { PushPrePrompt } from './SettingsPrompts'
import type { MemoryRow } from '@overlay/app-core'
import type {
  WorkspaceBillingSummaryResponse,
  WorkspaceManagementItem,
} from '@overlay/workspace-contracts'
import {
  ResourceHeading,
  ResourceLabel,
  ResourceRow,
  ResourceState,
} from '../knowledge/ResourceViews'
import { T, Button } from '../shell/primitives'
import type { BannerPreferences, BannerCategory } from '../../services/bannerPreferencesService'

export const SETTINGS_PAGES = [
  ['memories', 'Memories', Sparkles],
  ['members', 'Members', Users],
  ['models', 'Models and connections', Bot],
  ['billing', 'Billing', CreditCard],
  ['notifications', 'Notifications', Bell],
  ['webhooks', 'Webhooks', Webhook],
  ['voice', 'Voice and transcription', Mic],
  ['account', 'Account', User],
  ['help', 'Help and feedback', CircleHelp],
] as const
export type SettingsPage = 'settings' | (typeof SETTINGS_PAGES)[number][0] | 'push-permission'
export const BANNER_LABELS: [BannerCategory, string, string][] = [
  ['dm', 'Direct messages', 'Messages sent to you'],
  ['mention', 'Mentions', 'When someone mentions you'],
  ['thread', 'Thread replies', 'Threads you follow'],
  ['reaction', 'Reactions', 'Reactions to your messages'],
  ['channel', 'Channel messages', 'Your workspace conversations'],
]
export type SettingsViewData = {
  memories?: MemoryRow[]
  members?: WorkspaceManagementItem[]
  canManage?: boolean
  dark?: boolean
  rooms?: { id: string; title: string }[]
  workspaceName?: string
  providers?: {
    _id: string
    displayName: string
    status: string
    authKind?: string
    subscriptionProvider?: string
    isDeletable?: boolean
  }[]
  defaultModel?: string
  billing?: WorkspaceBillingSummaryResponse | null
  profile?: {
    displayName: string
    email: string
    photoUrl?: string | null
    headers?: Record<string, string>
  }
  bannerPreferences?: BannerPreferences
  permission?: string
  voiceEnabled?: boolean
  voiceSupported?: boolean
  retention?: number
  historyCount?: number
  appearance?: string
}
export type SettingsActions = {
  navigate: (page: SettingsPage) => void
  memory: (memory?: MemoryRow) => void
  invite: () => void
  invitation: (member: WorkspaceManagementItem) => void
  connection: (id?: string) => void
  defaultModel: () => void
  banner: (category: BannerCategory, enabled: boolean) => void
  room: (id: string) => void
  voice: (enabled: boolean) => void
  retention: () => void
  clearHistory: () => void
  saveName: (name: string) => Promise<void>
  photo: () => void
  signOut: () => void
  deleteAccount: () => void
  help: (kind: 'docs' | 'email' | 'bug') => void
  appearance: () => void
  permission: () => void
}
export function SettingMeta({
  theme,
  title,
  value,
}: {
  theme: Theme
  title: string
  value: string
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 20,
        paddingVertical: 17,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <T style={{ color: theme.muted, fontSize: 13 }}>{title}</T>
      <T style={{ color: theme.foreground, fontSize: 13, flexShrink: 1, textAlign: 'right' }}>
        {value}
      </T>
    </View>
  )
}
export function SettingToggle({
  theme,
  title,
  subtitle,
  value,
  disabled,
  onChange,
}: {
  theme: Theme
  title: string
  subtitle?: string
  value: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 17,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <View style={{ flex: 1, gap: 5 }}>
        <T style={{ color: theme.foreground, fontSize: 14 }}>{title}</T>
        {subtitle ? <T style={{ color: theme.muted, fontSize: 12 }}>{subtitle}</T> : null}
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: theme.surfaceSubtle, true: theme.foreground }}
        thumbColor={theme.surface}
      />
    </View>
  )
}
export function SettingsView({
  theme,
  page,
  data,
  actions,
  loading = false,
  error,
  busy = false,
  blocked = false,
  onRetry,
  webhooks,
}: {
  theme: Theme
  page: SettingsPage
  data: SettingsViewData
  actions: SettingsActions
  loading?: boolean
  error?: string | null
  busy?: boolean
  blocked?: boolean
  onRetry?: () => void
  webhooks?: React.ReactNode
}) {
  const [name, setName] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const title =
    page === 'settings'
      ? 'Settings'
      : page === 'push-permission'
        ? 'Stay in the loop'
        : (SETTINGS_PAGES.find((row) => row[0] === page)?.[1] ?? 'Settings')
  const copy = (text: string) => (
    <T style={{ color: theme.muted, fontSize: 13, lineHeight: 21, marginBottom: 22 }}>{text}</T>
  )
  const row = (label: string, icon: typeof Settings, onPress: () => void, subtitle?: string) => (
    <ResourceRow
      key={label}
      theme={page === 'settings' ? { ...theme, foreground: theme.muted } : theme}
      icon={icon}
      title={label}
      subtitle={subtitle}
      onPress={onPress}
    />
  )
  return (
    <View accessibilityLabel={`Settings ${page}`} style={{ gap: 0 }}>
      <ResourceHeading theme={theme} title={title} />
      {error ? <ResourceState theme={theme} error={error} onRetry={onRetry} /> : null}
      {loading ? (
        <ResourceState theme={theme} loading />
      ) : blocked ? null : (
        <>
          {page === 'settings' ? (
            <>
              {SETTINGS_PAGES.filter(([id]) => id !== 'webhooks' || webhooks).map(([id, label, Icon]) => (
                <View key={id} style={{ minHeight: 52, justifyContent: 'center' }}>
                  {row(label, Icon, () => actions.navigate(id))}
                </View>
              ))}
              <ResourceLabel theme={theme}>On this device</ResourceLabel>
              {row('Appearance', Settings, actions.appearance, data.appearance ?? 'System')}
            </>
          ) : null}
          {page === 'memories' ? (
            <>
              {copy('What Overlay remembers about you.')}
              <ResourceLabel theme={theme}>Memories</ResourceLabel>
              {data.memories?.length ? (
                data.memories.map((memory) => (
                  <Pressable
                    key={memory.key}
                    accessibilityRole="button"
                    accessibilityLabel={memory.content}
                    style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                    onPress={() => actions.memory(memory)}
                  >
                    <View style={{ flex: 1 }}>
                      <T
                        numberOfLines={2}
                        style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}
                      >
                        {memory.content}
                      </T>
                      {memory.creatorName ? (
                        <T style={{ color: theme.muted, fontSize: 11 }}>{memory.creatorName}</T>
                      ) : null}
                    </View>
                    <MoreHorizontal size={16} color={theme.muted} />
                  </Pressable>
                ))
              ) : (
                <ResourceState theme={theme} empty="No memories yet." />
              )}
              <View style={{ alignSelf: 'flex-start' }}>
                <Button theme={theme} secondary icon={Plus} onPress={() => actions.memory()}>
                  Add memory
                </Button>
              </View>
            </>
          ) : null}
          {page === 'members' ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
                <T style={{ flex: 1, color: theme.muted, fontSize: 12 }}>
                  {data.workspaceName} ·{' '}
                  {data.members?.filter((item) => item.kind === 'member').length ?? 0} members
                </T>
                {data.canManage ? (
                  <Button theme={theme} secondary icon={Plus} onPress={actions.invite}>
                    Invite
                  </Button>
                ) : null}
              </View>
              {data.members
                ?.filter((item) => item.kind === 'member')
                .map((member) => (
                  <ResourceRow
                    key={member.id}
                    theme={theme}
                    icon={User}
                    leading={
                      member.principalType === 'agent' ? (
                        <AgentAvatar
                          agent={{
                            name: member.name,
                            isDefault: member.isDefault,
                            avatarShape: member.avatarShape,
                            avatarColor: member.avatarColor,
                          }}
                          dark={data.dark ?? false}
                          foreground={theme.foreground}
                          size={30}
                        />
                      ) : (
                        <View
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 15,
                            backgroundColor: theme.surfaceSubtle,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <T style={{ color: theme.muted, fontSize: 11 }}>
                            {member.name
                              .split(' ')
                              .map((value) => value[0])
                              .slice(0, 2)
                              .join('')
                              .toUpperCase()}
                          </T>
                        </View>
                      )
                    }
                    title={member.name}
                    subtitle={member.description ?? member.detail}
                    trailing={
                      <T style={{ color: theme.muted, fontSize: 11 }}>
                        {member.role ?? member.badge}
                      </T>
                    }
                    onPress={() => actions.invitation(member)}
                  />
                ))}
              <ResourceLabel theme={theme}>Invitations</ResourceLabel>
              {data.members?.some((item) => item.kind === 'invitation')
                ? data.members
                    .filter((item) => item.kind === 'invitation')
                    .map((item) => (
                      <ResourceRow
                        key={item.id}
                        theme={theme}
                        icon={Mail}
                        title={item.name}
                        subtitle={item.detail ?? item.status}
                        onPress={() => actions.invitation(item)}
                      />
                    ))
                : copy(
                    data.canManage
                      ? 'No pending invitations.'
                      : 'Invitations are visible to workspace administrators.',
                  )}
            </>
          ) : null}
          {page === 'models' ? (
            <>
              {row('Default model', Bot, actions.defaultModel, data.defaultModel ?? 'Auto')}
              <ResourceLabel theme={theme}>Subscription connections</ResourceLabel>
              {data.providers
                ?.filter((item) => item.authKind === 'subscription')
                .map((item) =>
                  row(item.displayName, Zap, () => actions.connection(item._id), item.status),
                )}
              {!data.providers?.some((item) => item.authKind === 'subscription')
                ? copy('No connected subscriptions.')
                : null}
              <Button theme={theme} secondary icon={Plus} onPress={() => actions.connection()}>
                Connect subscription
              </Button>
              <ResourceLabel theme={theme}>API connections</ResourceLabel>
              {data.providers
                ?.filter((item) => item.authKind !== 'subscription')
                .map((item) =>
                  row(item.displayName, Shield, () => actions.connection(item._id), item.status),
                )}
              <Button
                theme={theme}
                secondary
                icon={Plus}
                onPress={() => actions.connection('new-api')}
              >
                Add connection
              </Button>
            </>
          ) : null}
          {page === 'billing' ? (
            data.billing ? (
              <>
                <View
                  style={{
                    backgroundColor: theme.surfaceSubtle,
                    padding: 22,
                    borderRadius: 10,
                    gap: 10,
                    marginBottom: 18,
                  }}
                >
                  <T style={{ color: theme.muted, fontSize: 12 }}>Current plan</T>
                  <T style={{ color: theme.foreground, fontSize: 29, fontWeight: '500' }}>
                    {data.billing.subscription.planKind === 'paid' ? 'Paid' : 'Free'}
                  </T>
                  <T style={{ color: theme.muted, fontSize: 12 }}>{data.workspaceName}</T>
                </View>
                <SettingMeta
                  theme={theme}
                  title="Available credits"
                  value={data.billing.credits.remaining.toLocaleString()}
                />
                <SettingMeta
                  theme={theme}
                  title="Used this period"
                  value={data.billing.credits.used.toLocaleString()}
                />
                <SettingMeta
                  theme={theme}
                  title="Status"
                  value={
                    data.billing.subscription.status ??
                    (data.billing.initialized ? 'Active' : 'Not initialized')
                  }
                />
                {data.billing.subscription.currentPeriodEnd ? (
                  <SettingMeta
                    theme={theme}
                    title="Period ends"
                    value={new Date(
                      data.billing.subscription.currentPeriodEnd *
                        (data.billing.subscription.currentPeriodEnd < 1e12 ? 1000 : 1),
                    ).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  />
                ) : null}
              </>
            ) : (
              <ResourceState theme={theme} empty="Billing information is unavailable." />
            )
          ) : null}
          {page === 'notifications' ? (
            <>
              {copy('Choose foreground banners on this device. Activity history is unchanged.')}
              <ResourceLabel theme={theme}>In-app banners</ResourceLabel>
              {BANNER_LABELS.map(([category, label, subtitle]) => (
                <SettingToggle
                  key={category}
                  theme={theme}
                  title={label}
                  subtitle={subtitle}
                  value={data.bannerPreferences?.[category] ?? true}
                  disabled={busy}
                  onChange={(value) => actions.banner(category, value)}
                />
              ))}
              <ResourceLabel theme={theme}>Device permission</ResourceLabel>
              {row(
                'Device notifications',
                Bell,
                () => actions.navigate('push-permission'),
                data.permission ?? 'Not requested',
              )}
              {copy(
                'Background notifications require device permission. Banner choices above apply on this device while using the app. Conversation notification levels below sync with your workspace.',
              )}
              <ResourceLabel theme={theme}>Conversation notifications</ResourceLabel>
              {data.rooms?.length
                ? data.rooms.map((room) =>
                    row(
                      room.title,
                      Bell,
                      () => actions.room(room.id),
                      'All messages, mentions, or muted',
                    ),
                  )
                : copy('No active conversations.')}
            </>
          ) : null}
          {page === 'voice' ? (
            <>
              <SettingToggle
                theme={theme}
                title="Voice input"
                subtitle={
                  data.voiceSupported
                    ? 'Transcribe messages'
                    : 'Background voice is available on iOS with the voice extension'
                }
                value={data.voiceEnabled ?? false}
                disabled={!data.voiceSupported || busy}
                onChange={actions.voice}
              />
              <ResourceLabel theme={theme}>Transcription</ResourceLabel>
              <SettingMeta theme={theme} title="Language" value="Auto detect" />
              {row(
                'Keep transcriptions',
                BookOpen,
                actions.retention,
                data.retention === 0 ? 'Off' : `${data.retention ?? 30} days`,
              )}
              {row(
                'Clear transcription history',
                Trash2,
                actions.clearHistory,
                `${data.historyCount ?? 0} on this device`,
              )}
              {copy(
                'Microphone access is requested when you enable voice or start recording. Transcription retention is local to this device.',
              )}
            </>
          ) : null}
          {page === 'account' ? (
            <>
              <View style={{ alignItems: 'center', gap: 10, marginBottom: 28 }}>
                <View
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: 29,
                    backgroundColor: theme.surfaceSubtle,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {data.profile?.photoUrl ? (
                    <Image
                      alt="Your profile"
                      accessibilityLabel="Account photo"
                      source={{ uri: data.profile.photoUrl, headers: data.profile.headers }}
                      style={{ width: 58, height: 58, borderRadius: 29 }}
                    />
                  ) : (
                    <User size={24} color={theme.foreground} />
                  )}
                </View>
                <T style={{ color: theme.foreground, fontSize: 19, fontWeight: '500' }}>
                  {data.profile?.displayName}
                </T>
                <T style={{ color: theme.muted, fontSize: 12 }}>{data.profile?.email}</T>
                <Button theme={theme} onPress={actions.photo}>
                  Change photo
                </Button>
              </View>
              <ResourceLabel theme={theme}>Name</ResourceLabel>
              <TextInput
                accessibilityLabel="Name"
                maxLength={80}
                style={{
                  color: theme.foreground,
                  borderColor: theme.border,
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 12,
                  fontFamily: 'Geist',
                  fontSize: 14,
                }}
                value={name ?? data.profile?.displayName ?? ''}
                onChangeText={setName}
              />
              <View style={{ height: 18 }} />
              <SettingMeta theme={theme} title="Email" value={data.profile?.email ?? ''} />
              <T style={{ color: theme.muted, fontSize: 11, marginTop: 8, marginBottom: 18 }}>
                Email is managed by your sign-in provider.
              </T>
              <Button
                theme={theme}
                secondary
                disabled={busy || savingName || name === null}
                onPress={() => {
                  if (savingName) return
                  setSavingName(true)
                  setNameError(null)
                  void actions
                    .saveName(name ?? '')
                    .then(() => setName(null))
                    .catch((value) =>
                      setNameError(value instanceof Error ? value.message : 'Could not save name.'),
                    )
                    .finally(() => setSavingName(false))
                }}
              >
                Save changes
              </Button>
              {nameError ? <ResourceState theme={theme} error={nameError} /> : null}
              <View style={{ height: 28 }} />
              {row('Sign out', User, actions.signOut)}
              {row(
                'Delete account',
                Trash2,
                actions.deleteAccount,
                'Permanently delete your account and data',
              )}
            </>
          ) : null}
          {page === 'webhooks' ? webhooks ?? copy('Webhooks are unavailable in this workspace.') : null}
          {page === 'help' ? (
            <>
              {row('Help centre', CircleHelp, () => actions.help('docs'), 'Guides and answers')}
              {row('Contact support', Mail, () => actions.help('email'), 'We’re here to help')}
              <ResourceLabel theme={theme}>Report a bug</ResourceLabel>
              {copy(
                'Bug reports and attachments are public on GitHub. In the web app, open Help → Submit a bug. You may need to sign in.',
              )}
              <Button
                theme={theme}
                secondary
                icon={ExternalLink}
                onPress={() => actions.help('bug')}
              >
                Submit a bug
              </Button>
              <T style={{ color: theme.muted, fontSize: 11, marginTop: 30 }}>
                Overlay for mobile · 1.0.0
              </T>
            </>
          ) : null}
          {page === 'push-permission' ? (
            <PushPrePrompt
              theme={theme}
              busy={busy}
              permission={data.permission}
              onContinue={actions.permission}
              onLater={() => actions.navigate('notifications')}
            />
          ) : null}
        </>
      )}
    </View>
  )
}
