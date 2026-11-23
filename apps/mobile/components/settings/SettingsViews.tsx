import { useSwitchTint } from '../../lib/nativeControls'
import React, { useState } from 'react'
import { ActivityIndicator, Image as RNImage, Text as RNText, ScrollView, View } from 'react-native'
import { Stack } from 'expo-router'
import {
  Button,
  Form,
  HStack,
  Host,
  Image as Symbol,
  LabeledContent,
  Picker,
  RNHostView,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
} from '@expo/ui/swift-ui'
import {
  foregroundStyle,
  frame,
  lineLimit,
  pickerStyle,
  submitLabel,
  tag,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import type { SFSymbol } from 'sf-symbols-typescript'
import type { Theme } from '../../constants/theme'
import { AgentAvatar } from '../shell/AgentAvatar'
import { PushPrePrompt } from './SettingsPrompts'
import type { MemoryRow } from '@overlay/app-core'
import type {
  WorkspaceBillingSummaryResponse,
  WorkspaceManagementItem,
} from '@overlay/workspace-contracts'
import { ResourceState } from '../knowledge/ResourceViews'
import type { BannerPreferences, BannerCategory } from '../../services/bannerPreferencesService'

export const SETTINGS_PAGES = [
  ['memories', 'Memories', 'sparkles'],
  ['members', 'Members', 'person.2'],
  ['models', 'Models and connections', 'cpu'],
  ['billing', 'Billing', 'creditcard'],
  ['notifications', 'Notifications', 'bell'],
  ['webhooks', 'Webhooks', 'arrow.triangle.branch'],
  ['voice', 'Voice and transcription', 'waveform'],
  ['account', 'Account', 'person.crop.circle'],
  ['help', 'Help and feedback', 'questionmark.circle'],
] as const satisfies readonly (readonly [string, string, SFSymbol])[]
export type SettingsPage = 'settings' | (typeof SETTINGS_PAGES)[number][0] | 'push-permission'
export type AppearanceMode = 'auto' | 'light' | 'dark'
export const BANNER_LABELS: [BannerCategory, string, string][] = [
  ['dm', 'Direct messages', 'Messages sent to you'],
  ['mention', 'Mentions', 'When someone mentions you'],
  ['thread', 'Thread replies', 'Threads you follow'],
  ['reaction', 'Reactions', 'Reactions to your messages'],
  ['channel', 'Channel messages', 'Your workspace conversations'],
]
const RETENTION_DAYS = [7, 30, 90, 365, 0] as const
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
  /** Display label: System, Light or Dark. */
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
  retention: (days?: number) => void
  clearHistory: () => void
  saveName: (name: string) => Promise<void>
  photo: () => void
  signOut: () => void
  deleteAccount: () => void
  help: (kind: 'docs' | 'email' | 'bug') => void
  appearance: (mode?: AppearanceMode) => void
  permission: () => void
  /** Leaves the current Settings page (used by the notification pre-prompt). */
  back?: () => void
}

export const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

/** A tappable form row that opens something: icon, title, current value, chevron. */
export function NavRow({
  title,
  icon,
  value,
  onPress,
  disabled,
}: {
  title: string
  icon?: SFSymbol
  value?: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Button onPress={disabled ? undefined : onPress}>
      <HStack spacing={12}>
        {icon ? <Symbol systemName={icon} size={17} modifiers={[frame({ width: 26 })]} /> : null}
        <Text>{title}</Text>
        <Spacer />
        {value ? <Text modifiers={[secondary, lineLimit(1)]}>{value}</Text> : null}
        <Symbol systemName="chevron.right" size={12} modifiers={[secondary]} />
      </HStack>
    </Button>
  )
}

/** A form action with a leading icon, drawn in the text colour (system buttons tint icons blue). */
export function ActionRow({ title, icon, onPress }: { title: string; icon: SFSymbol; onPress: () => void }) {
  return (
    <Button onPress={onPress}>
      <HStack spacing={12}>
        <Symbol systemName={icon} size={17} modifiers={[frame({ width: 26 })]} />
        <Text>{title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}

function formatDate(seconds: number) {
  return new Date(seconds * (seconds < 1e12 ? 1000 : 1)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })
}

export function sentence(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : value
}

function initials(name: string) {
  return name
    .split(' ')
    .map((value) => value[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * One Settings page as a native SwiftUI form under the navigation bar. The
 * home page lists the sections; each section opens as its own pushed page.
 */
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
  // A name edit only counts against the saved name it started from, so a
  // refreshed profile (or the field reporting its initial value) never shows Save.
  const switchTint = useSwitchTint()
  const [edit, setEdit] = useState<{ base: string; value: string } | null>(null)
  const savedName = data.profile?.displayName ?? ''
  const name = edit && edit.base === savedName && edit.value.trim() !== savedName ? edit.value : null
  const [nameError, setNameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const title =
    page === 'settings'
      ? 'Settings'
      : page === 'push-permission'
        ? 'Notifications'
        : (SETTINGS_PAGES.find((row) => row[0] === page)?.[1] ?? 'Settings')
  const screen = <Stack.Screen options={{ title }} />
  const plain = (children: React.ReactNode) => (
    <>
      {screen}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }}
      >
        {children}
      </ScrollView>
    </>
  )

  if (loading)
    return (
      <>
        {screen}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
          <ActivityIndicator color={theme.muted as string} />
        </View>
      </>
    )
  if (blocked) return plain(<ResourceState theme={theme} error={error ?? undefined} onRetry={onRetry} />)
  if (page === 'webhooks' && !webhooks)
    return plain(<ResourceState theme={theme} empty="Webhooks are unavailable in this workspace." />)
  if (page === 'push-permission')
    return plain(
      <PushPrePrompt
        theme={theme}
        busy={busy}
        permission={data.permission}
        onContinue={actions.permission}
        onLater={() => (actions.back ? actions.back() : actions.navigate('notifications'))}
      />,
    )

  const errorSection = error ? (
    <Section>
      <Text>{error}</Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} /> : null}
    </Section>
  ) : null
  const members = data.members?.filter((item) => item.kind === 'member') ?? []
  const invitations = data.members?.filter((item) => item.kind === 'invitation') ?? []
  const subscriptions = data.providers?.filter((item) => item.authKind === 'subscription') ?? []
  const apiConnections = data.providers?.filter((item) => item.authKind !== 'subscription') ?? []
  const billing = data.billing

  return (
    <>
      {screen}
      <Host style={{ flex: 1 }} colorScheme={data.dark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>
          {errorSection}

          {page === 'settings' ? (
            <>
              <Section>
                {SETTINGS_PAGES.filter(([id]) => id !== 'webhooks' || webhooks).map(([id, label, icon]) => (
                  <NavRow key={id} title={label} icon={icon} onPress={() => actions.navigate(id)} />
                ))}
              </Section>
              <Section title="On this device">
                <Picker
                  label="Appearance"
                  selection={data.appearance ?? 'System'}
                  onSelectionChange={(value: string) =>
                    actions.appearance(value === 'Dark' ? 'dark' : value === 'Light' ? 'light' : 'auto')
                  }
                  modifiers={[pickerStyle('menu')]}
                >
                  {['System', 'Light', 'Dark'].map((value) => (
                    <Text key={value} modifiers={[tag(value)]}>{value}</Text>
                  ))}
                </Picker>
              </Section>
            </>
          ) : null}

          {page === 'memories' ? (
            <>
              <Section
                title="What Overlay remembers"
                footer={data.memories?.length ? undefined : <Text>No memories yet. Add one, or Overlay saves them as you chat.</Text>}
              >
                {data.memories?.map((memory) => (
                  <Button key={memory.key} onPress={() => actions.memory(memory)}>
                    <HStack>
                      <Text modifiers={[lineLimit(3)]}>{memory.content}</Text>
                      <Spacer />
                    </HStack>
                  </Button>
                ))}
              </Section>
              <Section>
                <ActionRow title="Add memory" icon="plus" onPress={() => actions.memory()} />
              </Section>
            </>
          ) : null}

          {page === 'members' ? (
            <>
              <Section
                title={`${data.workspaceName ?? 'Workspace'} · ${members.length} ${members.length === 1 ? 'member' : 'members'}`}
              >
                {members.map((member) => (
                  <Button key={member.id} onPress={() => actions.invitation(member)}>
                    <HStack spacing={12}>
                      <RNHostView matchContents>
                        {member.principalType === 'agent' ? (
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
                          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                            <RNInitials text={initials(member.name)} color={theme.muted as string} />
                          </View>
                        )}
                      </RNHostView>
                      <Text modifiers={[lineLimit(1)]}>{member.name}</Text>
                      <Spacer />
                      <Text modifiers={[secondary]}>{sentence(member.role ?? member.badge ?? '')}</Text>
                    </HStack>
                  </Button>
                ))}
                {data.canManage ? <ActionRow title="Invite people" icon="person.badge.plus" onPress={actions.invite} /> : null}
              </Section>
              <Section
                title="Invitations"
                footer={
                  invitations.length
                    ? undefined
                    : <Text>{data.canManage ? 'No pending invitations.' : 'Invitations are visible to workspace admins.'}</Text>
                }
              >
                {invitations.map((item) => (
                  <NavRow key={item.id} title={item.name} icon="envelope" value={item.detail ?? item.status} onPress={() => actions.invitation(item)} />
                ))}
              </Section>
            </>
          ) : null}

          {page === 'models' ? (
            <>
              <Section>
                <NavRow title="Default model" icon="cpu" value={data.defaultModel ?? 'Auto'} onPress={actions.defaultModel} />
              </Section>
              <Section
                title="Subscriptions"
                footer={<Text>Use a ChatGPT or other AI subscription you already pay for.</Text>}
              >
                {subscriptions.map((item) => (
                  <NavRow key={item._id} title={item.displayName} icon="bolt" value={sentence(item.status)} onPress={() => actions.connection(item._id)} />
                ))}
                <ActionRow title="Connect a subscription" icon="plus" onPress={() => actions.connection()} />
              </Section>
              <Section title="API keys">
                {apiConnections.map((item) => (
                  <NavRow key={item._id} title={item.displayName} icon="key" value={sentence(item.status)} onPress={() => actions.connection(item._id)} />
                ))}
                <ActionRow title="Add an API key" icon="plus" onPress={() => actions.connection('new-api')} />
              </Section>
            </>
          ) : null}

          {page === 'billing' ? (
            billing ? (
              <>
                <Section title={data.workspaceName}>
                  <LabeledContent label="Plan">
                    <Text>{billing.subscription.planKind === 'paid' ? 'Paid' : 'Free'}</Text>
                  </LabeledContent>
                  <LabeledContent label="Status">
                    <Text>{sentence(billing.subscription.status ?? (billing.initialized ? 'active' : 'not set up'))}</Text>
                  </LabeledContent>
                  {billing.subscription.currentPeriodEnd ? (
                    <LabeledContent label="Renews">
                      <Text>{formatDate(billing.subscription.currentPeriodEnd)}</Text>
                    </LabeledContent>
                  ) : null}
                </Section>
                <Section title="Credits this period">
                  <LabeledContent label="Available">
                    <Text>{billing.credits.remaining.toLocaleString()}</Text>
                  </LabeledContent>
                  <LabeledContent label="Used">
                    <Text>{billing.credits.used.toLocaleString()}</Text>
                  </LabeledContent>
                </Section>
              </>
            ) : (
              <Section>
                <Text>Billing information is unavailable.</Text>
              </Section>
            )
          ) : null}

          {page === 'notifications' ? (
            <>
              <Section
                title="Device"
                footer={<Text>Needed for notifications when Overlay isn&apos;t open.</Text>}
              >
                <NavRow title="Notifications" icon="bell.badge" value={data.permission ?? 'Not requested'} onPress={() => actions.navigate('push-permission')} />
              </Section>
              <Section
                title="Banners while using the app"
                footer={<Text>Applies on this device only. Your Activity history is unchanged.</Text>}
              >
                {BANNER_LABELS.map(([category, label]) => (
                  <Toggle
                    modifiers={switchTint}
                    key={category}
                    label={label}
                    isOn={data.bannerPreferences?.[category] ?? true}
                    onIsOnChange={(value) => {
                      if (!busy) actions.banner(category, value)
                    }}
                  />
                ))}
              </Section>
              <Section
                title="Conversations"
                footer={<Text>{data.rooms?.length ? 'All messages, mentions only, or muted. Syncs with your workspace.' : 'No active conversations.'}</Text>}
              >
                {data.rooms?.map((room) => (
                  <NavRow key={room.id} title={room.title} onPress={() => actions.room(room.id)} />
                ))}
              </Section>
            </>
          ) : null}

          {page === 'voice' ? (
            <>
              <Section
                footer={<Text>{data.voiceSupported ? 'Dictate into any text field with Overlay Voice.' : 'Background voice needs the Overlay voice extension on iOS.'}</Text>}
              >
                <Toggle
                  modifiers={switchTint}
                  label="Voice input"
                  isOn={data.voiceEnabled ?? false}
                  onIsOnChange={(value) => {
                    if (data.voiceSupported && !busy) actions.voice(value)
                  }}
                />
              </Section>
              <Section
                title="Transcription"
                footer={<Text>Microphone access is asked for when you first record. Transcriptions stay on this device.</Text>}
              >
                <LabeledContent label="Language">
                  <Text>Auto detect</Text>
                </LabeledContent>
                <Picker
                  label="Keep transcriptions"
                  selection={data.retention ?? 30}
                  onSelectionChange={(days: number) => actions.retention(days)}
                  modifiers={[pickerStyle('menu')]}
                >
                  {RETENTION_DAYS.map((days) => (
                    <Text key={days} modifiers={[tag(days)]}>{days === 0 ? 'Off' : `${days} days`}</Text>
                  ))}
                </Picker>
                <Button
                  role="destructive"
                  label={`Clear history (${data.historyCount ?? 0})`}
                  onPress={actions.clearHistory}
                />
              </Section>
            </>
          ) : null}

          {page === 'account' ? (
            <>
              <Section>
                <HStack spacing={14}>
                  <RNHostView matchContents>
                    <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.surfaceSubtle, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {data.profile?.photoUrl ? (
                        <RNImage
                          alt="Your profile"
                          accessibilityLabel="Account photo"
                          source={{ uri: data.profile.photoUrl, headers: data.profile.headers }}
                          style={{ width: 56, height: 56 }}
                        />
                      ) : (
                        <RNInitials text={initials(data.profile?.displayName ?? '?')} color={theme.muted as string} size={18} />
                      )}
                    </View>
                  </RNHostView>
                  <Text modifiers={[lineLimit(1)]}>{data.profile?.displayName ?? ''}</Text>
                  <Spacer />
                </HStack>
                <ActionRow title="Change photo" icon="camera" onPress={actions.photo} />
              </Section>
              <Section
                title="Name"
                footer={nameError ? <Text>{nameError}</Text> : undefined}
              >
                <TextField
                  key={savedName}
                  // Keep an unsaved edit if SwiftUI rebuilds the field (e.g. when an error appears).
                  defaultValue={name ?? savedName}
                  placeholder="Your name"
                  onValueChange={(value) => setEdit({ base: savedName, value })}
                  modifiers={[textInputAutocapitalization('words'), submitLabel('done')]}
                />
                {name !== null ? (
                  <Button
                    label={savingName ? 'Saving…' : 'Save name'}
                    onPress={() => {
                      if (savingName || busy) return
                      setSavingName(true)
                      setNameError(null)
                      void actions
                        .saveName(name ?? '')
                        .then(() => setEdit(null))
                        .catch((value) =>
                          setNameError(value instanceof Error ? value.message : 'Could not save name.'),
                        )
                        .finally(() => setSavingName(false))
                    }}
                  />
                ) : null}
              </Section>
              <Section footer={<Text>Email is managed by your sign-in provider.</Text>}>
                <LabeledContent label="Email">
                  <Text>{data.profile?.email ?? ''}</Text>
                </LabeledContent>
              </Section>
              <Section>
                <Button label="Sign out" onPress={actions.signOut} />
                <Button role="destructive" label="Delete account" onPress={actions.deleteAccount} />
              </Section>
            </>
          ) : null}

          {page === 'webhooks' ? webhooks : null}

          {page === 'help' ? (
            <>
              <Section>
                <NavRow title="Help centre" icon="book" onPress={() => actions.help('docs')} />
                <NavRow title="Contact support" icon="envelope" onPress={() => actions.help('email')} />
              </Section>
              <Section
                title="Report a bug"
                footer={<Text>Bug reports and attachments are public on GitHub. You may need to sign in on the web.{'\n\n'}Overlay for iOS · 1.0.0</Text>}
              >
                <ActionRow title="Submit a bug" icon="ladybug" onPress={() => actions.help('bug')} />
              </Section>
            </>
          ) : null}
        </Form>
      </Host>
    </>
  )
}

/** Initials drawn as React Native text inside a hosted RN view. */
function RNInitials({ text, color, size = 11 }: { text: string; color: string; size?: number }) {
  return <RNText style={{ color, fontSize: size, fontFamily: 'GeistMedium' }}>{text}</RNText>
}
