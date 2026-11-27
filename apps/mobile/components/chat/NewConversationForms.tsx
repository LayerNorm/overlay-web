import React, { useEffect, useMemo, useState } from 'react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Button,
  Form,
  HStack,
  Host,
  Image as Symbol,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
} from '@expo/ui/swift-ui'
import {
  autocorrectionDisabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  pickerStyle,
  tag,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import type { ChannelVisibility } from '@overlay/workspace-contracts'
import { useTheme } from '../../hooks/useTheme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { getRequestWorkspaceId } from '../../services/appApi'
import {
  addRoomParticipant,
  createChannel,
  createDirectMessage,
  searchWorkspacePrincipals,
  type RoomPrincipalOption,
} from '../../services/collaborationService'

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

/** Form sheet chrome: Cancel on the left, ✓ on the right, a native Form body. */
function SheetForm({
  title,
  done,
  children,
}: {
  title: string
  done: { label: string; disabled: boolean; onPress: () => void }
  children: React.ReactNode
}) {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  return (
    <>
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cancel" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="checkmark"
          variant="prominent"
          tintColor={theme.foreground as string}
          accessibilityLabel={done.label}
          disabled={done.disabled}
          onPress={done.onPress}
        />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>{children}</Form>
      </Host>
    </>
  )
}

/** Workspace people and agents, loaded once per sheet. */
function usePrincipals(workspaceId: string | null) {
  const [state, setState] = useState<{ options: RoomPrincipalOption[] | null; error: string | null }>({ options: null, error: null })
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    searchWorkspacePrincipals(workspaceId)
      .then(({ options }) => { if (active) setState({ options, error: null }) })
      .catch(() => { if (active) setState({ options: [], error: 'Could not load workspace members.' }) })
    return () => { active = false }
  }, [workspaceId])
  return state
}

/** Search field plus a tappable list of people; ticked rows are selected. */
function PeoplePicker({
  options,
  selected,
  onToggle,
  title,
  footer,
}: {
  options: RoomPrincipalOption[] | null
  selected: readonly string[]
  onToggle: (principalId: string) => void
  title?: string
  footer?: string
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (options ?? []).filter((option) => !needle || `${option.name} ${option.description ?? ''}`.toLowerCase().includes(needle))
  }, [options, query])
  return (
    <>
      <Section title={title}>
        <HStack spacing={8}>
          <Symbol systemName="magnifyingglass" size={15} modifiers={[secondary]} />
          <TextField
            placeholder="Search people and agents"
            onValueChange={setQuery}
            modifiers={[textInputAutocapitalization('never'), autocorrectionDisabled()]}
          />
        </HStack>
      </Section>
      <Section
        footer={
          <Text>
            {options === null ? 'Loading…' : !matches.length ? (query.trim() ? 'No matches.' : 'Nobody else is in this workspace yet.') : (footer ?? '')}
          </Text>
        }
      >
        {matches.map((option) => (
          <Button key={option.principalId} onPress={() => onToggle(option.principalId)}>
            <HStack spacing={12}>
              <Symbol
                systemName={option.principalType === 'agent' ? 'sparkles' : 'person.crop.circle'}
                size={20}
                modifiers={[frame({ width: 26 }), secondary]}
              />
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[lineLimit(1)]}>{option.name}</Text>
                {option.description ? <Text modifiers={[secondary, font({ size: 13 }), lineLimit(1)]}>{option.description}</Text> : null}
              </VStack>
              <Spacer />
              {selected.includes(option.principalId) ? <Symbol systemName="checkmark" size={15} /> : null}
            </HStack>
          </Button>
        ))}
      </Section>
    </>
  )
}

function toggled(values: readonly string[], id: string) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
}

/**
 * `/new-message` — start a DM or group DM. With `add` (and `type`), adds
 * people to that room instead; with `source`, continues a personal chat
 * with people.
 */
export function NewMessageScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ add?: string; type?: string; exclude?: string; source?: string }>()
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const excluded = useMemo(() => (params.exclude ? params.exclude.split(',') : []), [params.exclude])
  const principals = usePrincipals(workspaceId)
  const options = useMemo(
    () => principals.options?.filter((option) => !excluded.includes(option.principalId)) ?? null,
    [principals.options, excluded],
  )
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const addingToChannel = Boolean(params.add) && params.type !== 'dm'
  const title = params.add ? (addingToChannel ? 'Add people' : 'Start a group DM') : params.source ? 'Continue with people' : 'New message'

  async function submit() {
    if (!workspaceId || busy || !selected.length) return
    setBusy(true)
    setError(null)
    try {
      if (params.add && addingToChannel) {
        await Promise.all(selected.map((principalId) => addRoomParticipant(params.add!, principalId)))
        router.back()
        return
      }
      const dm = await createDirectMessage(workspaceId, {
        principalIds: params.add ? [...excluded, ...selected] : selected,
        ...(params.source ? { sourceConversationId: params.source } : {}),
      })
      if (getRequestWorkspaceId() !== workspaceId) return
      router.back()
      router.push(`/dm/${dm.conversationId}` as never)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the message.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SheetForm title={title} done={{ label: title, disabled: busy || !selected.length, onPress: () => void submit() }}>
      <PeoplePicker
        options={options}
        selected={selected}
        onToggle={(id) => setSelected((values) => toggled(values, id))}
        footer={error ?? principals.error ?? (selected.length > 1 ? `${selected.length} people · starts a group message` : undefined)}
      />
    </SheetForm>
  )
}

/** `/new-channel` — name, topic, visibility, and members for private channels. */
export function NewChannelScreen() {
  const router = useRouter()
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [visibility, setVisibility] = useState<ChannelVisibility>('public')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const principals = usePrincipals(visibility === 'private' ? workspaceId : null)

  async function submit() {
    const trimmed = name.trim().replace(/^#/, '')
    if (!workspaceId || busy || !trimmed) return
    setBusy(true)
    setError(null)
    try {
      const channel = await createChannel(workspaceId, {
        name: trimmed,
        ...(topic.trim() ? { topic: topic.trim() } : {}),
        visibility,
        ...(visibility === 'private' && selected.length ? { principalIds: selected } : {}),
      })
      if (!channel || getRequestWorkspaceId() !== workspaceId) return
      router.back()
      router.push(`/channel/${channel.conversationId}` as never)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the channel.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SheetForm title="New channel" done={{ label: 'Create channel', disabled: busy || !name.trim(), onPress: () => void submit() }}>
      <Section footer={error ? <Text>{error}</Text> : undefined}>
        <HStack spacing={6}>
          <Text modifiers={[secondary]}>#</Text>
          <TextField
            placeholder="channel-name"
            onValueChange={setName}
            modifiers={[textInputAutocapitalization('never'), autocorrectionDisabled()]}
          />
        </HStack>
        <TextField placeholder="Topic (optional)" onValueChange={setTopic} />
      </Section>
      <Section
        footer={
          <Text>
            {visibility === 'public' ? 'Everyone in the workspace can find and join this channel.' : 'Only the people you add can see this channel.'}
          </Text>
        }
      >
        <Picker selection={visibility} onSelectionChange={(value: ChannelVisibility) => setVisibility(value)} modifiers={[pickerStyle('segmented')]}>
          <Text modifiers={[tag('public')]}>Public</Text>
          <Text modifiers={[tag('private')]}>Private</Text>
        </Picker>
      </Section>
      {visibility === 'private' ? (
        <PeoplePicker
          title="Members"
          options={principals.options}
          selected={selected}
          onToggle={(id) => setSelected((values) => toggled(values, id))}
          footer={principals.error ?? undefined}
        />
      ) : null}
    </SheetForm>
  )
}
