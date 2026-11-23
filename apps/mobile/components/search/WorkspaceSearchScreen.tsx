import React, { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { Stack } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import {
  Button,
  ContentUnavailableView,
  ContextMenu,
  Form,
  HStack,
  Host,
  Image as Symbol,
  Picker,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import { buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, pickerStyle, shapes, tag, tint } from '@expo/ui/swift-ui/modifiers'
import { api } from '../../services/convexClient'
import { useLiveResource } from '../../hooks/useLiveResource'
import { getRequestWorkspaceId } from '../../services/appApi'
import { createDirectMessage } from '../../services/collaborationService'
import { openAgentThread } from '../../services/shellService'
import { openConversationDestination } from '../../lib/notificationRouting'
import type { WorkspaceSearchResult } from '../../services/searchService'
import { useResourceScope } from '../knowledge/ResourceScreens'
import { TabToolbar } from '../navigation/nativeHeader'

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const rowButton = [buttonStyle('borderless')]
type SymbolName = NonNullable<React.ComponentProps<typeof Symbol>['systemName']>

type Filter = 'all' | WorkspaceSearchResult['kind']
const GROUPS: Array<{ kind: WorkspaceSearchResult['kind']; title: string; icon: SymbolName }> = [
  { kind: 'work', title: 'Work', icon: 'checklist' },
  { kind: 'conversation', title: 'Chats', icon: 'bubble.left' },
  { kind: 'file', title: 'Files', icon: 'doc' },
  { kind: 'automation', title: 'Automations', icon: 'bolt' },
]

type Person = { id: string; name: string; subtitle: string; agentId?: string }

function Row({ icon, title, subtitle }: { icon: SymbolName; title: string; subtitle?: string }) {
  return (
    <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
      <Symbol systemName={icon} size={17} modifiers={[frame({ width: 26 }), secondary]} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[lineLimit(1)]}>{title}</Text>
        {subtitle ? <Text modifiers={[secondary, font({ size: 13 }), lineLimit(1)]}>{subtitle}</Text> : null}
      </VStack>
      <Spacer />
    </HStack>
  )
}

const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/[_-]/g, ' ')

/**
 * Workspace search: the system search bar (the Search tab's field), results
 * grouped into native sections, a Show menu to narrow them, and native context
 * menus. Tap a person to message them (or open an agent's chat); touch and
 * hold for Copy mention and, for agents, Agent settings.
 */
export function WorkspaceSearchScreen() {
  const { workspaceId, isDark, theme, router } = useResourceScope()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim().replace(/^@/, '')), 200)
    return () => clearTimeout(timer)
  }, [query])
  const canSearch = debounced.length >= 2
  const search = useLiveResource(api.search.browse.mentions, workspaceId && canSearch ? { workspaceId, query: debounced } : null)
  const work = useLiveResource(api.work.browse.list, workspaceId && canSearch ? { workspaceId } : null)
  const directory = useLiveResource(api.collaboration.management.view, workspaceId && canSearch ? { workspaceId, view: 'people' } : null)
  const agents = useLiveResource(api.agents.directory.list, workspaceId && canSearch ? { workspaceId } : null)
  const needle = debounced.toLowerCase()

  const results: WorkspaceSearchResult[] = [
    ...(search.data?.chats.map((row) => ({ kind: 'conversation' as const, id: row.id, title: row.title })) ?? []),
    ...(search.data?.files.map((row) => ({ kind: 'file' as const, id: row.id, title: row.name })) ?? []),
    ...(search.data?.automations.map((row) => ({
      kind: 'automation' as const,
      id: row.id,
      title: row.name || 'Automation',
      snippet: row.description,
    })) ?? []),
    ...(work.data
      ?.filter((row) => row.title.toLowerCase().includes(needle))
      .map((row) => ({ kind: 'work' as const, id: row.id, title: row.title, subtitle: sentence(row.status) })) ?? []),
  ]
  const people: Person[] = [
    ...(directory.data?.items
      .filter((row) => row.kind === 'member' && row.name.toLowerCase().includes(needle))
      .map((row) => ({ id: row.principalId || row.id, name: row.name, subtitle: row.description || 'Member' })) ?? []),
    ...(agents.data?.agents
      .filter((row) => row.name.toLowerCase().includes(needle))
      .map((row) => ({ id: `agent:${row.id}`, name: row.name, subtitle: 'Agent', agentId: row.id })) ?? []),
  ]
  const current = query.trim().replace(/^@/, '') === debounced
  const loading = canSearch && (!current || search.loading)
  const error = search.error || work.error || directory.error || agents.error

  const scoped = (operation: (scope: string) => Promise<void>) => {
    const scope = workspaceId
    if (!scope || getRequestWorkspaceId() !== scope) return
    void operation(scope).catch((cause) => {
      if (getRequestWorkspaceId() === scope)
        Alert.alert('Could not open the conversation', cause instanceof Error ? cause.message : 'Try again in a moment.')
    })
  }
  const open = (result: WorkspaceSearchResult) => {
    if (!workspaceId || getRequestWorkspaceId() !== workspaceId) return
    if (result.kind === 'conversation') void openConversationDestination(router, result.id)
    else if (result.kind === 'work') router.push({ pathname: '/work/[id]', params: { id: result.id } })
    else if (result.kind === 'automation') router.push({ pathname: '/automations', params: { id: result.id } })
    else router.push(`/files/file/${result.id}` as never)
  }
  const message = (person: Person) =>
    scoped(async (scope) => {
      const room = person.agentId
        ? await openAgentThread(scope, person.agentId)
        : await createDirectMessage(scope, { principalIds: [person.id] })
      if (room && getRequestWorkspaceId() === scope) router.push(`/dm/${room.conversationId}` as never)
    })

  const groups = GROUPS.filter((group) => filter === 'all' || filter === group.kind)
    .map((group) => ({ ...group, items: results.filter((result) => result.kind === group.kind) }))
    .filter((group) => group.items.length)
  const showPeople = filter === 'all' && people.length > 0
  const nothing = canSearch && current && !loading && !error && !groups.length && !showPeople
  const empty = nothing && filter === 'all'

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerSearchBarOptions: {
            placeholder: 'Search or @name',
            autoCapitalize: 'none',
            hideWhenScrolling: false,
            onChangeText: (event) => setQuery(event.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      <TabToolbar />
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        {!canSearch ? (
          <ContentUnavailableView
            title="Search your workspace"
            systemImage="magnifyingglass"
            description="Find chats, files, tasks and automations, or type @ and a name to message someone."
          />
        ) : error ? (
          <ContentUnavailableView title="Search isn't available" systemImage="exclamationmark.triangle" description={error} />
        ) : empty ? (
          <ContentUnavailableView
            title={`No results for “${debounced}”`}
            systemImage="magnifyingglass"
            description="Check the spelling or try a different search."
          />
        ) : (
          <Form modifiers={[tint(theme.foreground as string)]}>
            <Section>
              <Picker label="Show" selection={filter} onSelectionChange={(value: Filter) => setFilter(value)} modifiers={[pickerStyle('menu')]}>
                <Text modifiers={[tag('all')]}>Everything</Text>
                {GROUPS.map((group) => (
                  <Text key={group.kind} modifiers={[tag(group.kind)]}>{group.title}</Text>
                ))}
              </Picker>
            </Section>
            {loading && !groups.length && !showPeople ? (
              <Section footer={<Text>Searching…</Text>}>{null}</Section>
            ) : null}
            {nothing ? (
              <Section footer={<Text>{`Nothing in ${GROUPS.find((group) => group.kind === filter)?.title ?? 'this group'} matches “${debounced}”.`}</Text>}>{null}</Section>
            ) : null}
            {showPeople ? (
              <Section title="People" footer={<Text>Tap to send a message. Touch and hold to copy a mention.</Text>}>
                {people.map((person) => (
                  <ContextMenu key={person.id}>
                    <ContextMenu.Items>
                      <Button label={person.agentId ? 'Open chat' : 'Message'} systemImage="bubble.left" onPress={() => message(person)} />
                      <Button
                        label="Copy mention"
                        systemImage="at"
                        onPress={() => void Clipboard.setStringAsync('@' + person.name)}
                      />
                      {person.agentId ? (
                        <Button
                          label="Agent settings"
                          systemImage="slider.horizontal.3"
                          onPress={() => router.push({ pathname: '/agent/[id]', params: { id: person.agentId! } })}
                        />
                      ) : null}
                    </ContextMenu.Items>
                    <ContextMenu.Trigger>
                      <Button onPress={() => message(person)} modifiers={rowButton}>
                        <Row icon={person.agentId ? 'sparkles' : 'person.crop.circle'} title={person.name} subtitle={person.subtitle} />
                      </Button>
                    </ContextMenu.Trigger>
                  </ContextMenu>
                ))}
              </Section>
            ) : null}
            {groups.map((group) => (
              <Section key={group.kind} title={group.title}>
                {group.items.map((result) => (
                  <ContextMenu key={result.kind + result.id}>
                    <ContextMenu.Items>
                      <Button label="Open" systemImage="arrow.up.right" onPress={() => open(result)} />
                      <Button label="Copy name" systemImage="doc.on.doc" onPress={() => void Clipboard.setStringAsync(result.title)} />
                    </ContextMenu.Items>
                    <ContextMenu.Trigger>
                      <Button onPress={() => open(result)} modifiers={rowButton}>
                        <Row icon={group.icon} title={result.title} subtitle={result.snippet || result.subtitle} />
                      </Button>
                    </ContextMenu.Trigger>
                  </ContextMenu>
                ))}
              </Section>
            ))}
          </Form>
        )}
      </Host>
    </>
  )
}
