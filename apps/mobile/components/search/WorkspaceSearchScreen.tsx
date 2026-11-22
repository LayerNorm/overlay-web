import React, { useEffect, useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import { api } from '../../services/convexClient'
import { useLiveResource } from '../../hooks/useLiveResource'
import { getRequestWorkspaceId } from '../../services/appApi'
import { createDirectMessage } from '../../services/collaborationService'
import { openConversationDestination } from '../../lib/notificationRouting'
import type { WorkspaceSearchResult } from '../../services/searchService'
import { useResourceScope } from '../knowledge/ResourceScreens'
import {
  ResourcePage,
  ResourceRow,
  ResourceSheet,
  ResourceState,
  SearchResults,
} from '../knowledge/ResourceViews'

export function WorkspaceSearchScreen() {
  const { workspaceId, theme, isDark, router } = useResourceScope()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [person, setPerson] = useState<{ id: string; name: string; agentId?: string } | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim().replace(/^@/, '')), 200)
    return () => clearTimeout(timer)
  }, [query])
  const canSearch = debounced.length >= 2
  const search = useLiveResource(
    api.search.browse.mentions,
    workspaceId && canSearch ? { workspaceId, query: debounced } : null,
  )
  const work = useLiveResource(
    api.work.browse.list,
    workspaceId && canSearch ? { workspaceId } : null,
  )
  const directory = useLiveResource(
    api.collaboration.management.view,
    workspaceId && canSearch ? { workspaceId, view: 'people' } : null,
  )
  const agents = useLiveResource(
    api.agents.directory.list,
    workspaceId && canSearch ? { workspaceId } : null,
  )
  const results: WorkspaceSearchResult[] = [
    ...(search.data?.chats.map((row) => ({
      kind: 'conversation' as const,
      id: row.id,
      title: row.title,
    })) ?? []),
    ...(search.data?.files.map((row) => ({ kind: 'file' as const, id: row.id, title: row.name })) ??
      []),
    ...(search.data?.automations.map((row) => ({
      kind: 'automation' as const,
      id: row.id,
      title: row.name || 'Automation',
      snippet: row.description,
    })) ?? []),
    ...(work.data
      ?.filter((row) => row.title.toLowerCase().includes(debounced.toLowerCase()))
      .map((row) => ({
        kind: 'work' as const,
        id: row.id,
        title: row.title,
        subtitle: row.status,
      })) ?? []),
  ]
  const people = [
    ...(directory.data?.items
      .filter(
        (row) => row.kind === 'member' && row.name.toLowerCase().includes(debounced.toLowerCase()),
      )
      .map((row) => ({ id: row.principalId || row.id, name: row.name, subtitle: 'Member' })) ?? []),
    ...(agents.data?.agents
      .filter((row) => row.name.toLowerCase().includes(debounced.toLowerCase()))
      .map((row) => ({
        id: `agent:${row.id}`,
        name: row.name,
        subtitle: 'Agent',
        agentId: row.id,
        agent: row,
      })) ?? []),
  ]
  const current = query.trim().replace(/^@/, '') === debounced
  return (
    <ResourcePage
      theme={theme}
      title="Search"
    >
      <SearchResults
        theme={theme}
        dark={isDark}
        loading={search.loading || !current}
        query={query}
        onQuery={setQuery}
        results={current ? results : []}
        people={current ? people : []}
        onPerson={(id) => {
          const found = people.find((row) => row.id === id)
          if (found) setPerson(found)
        }}
        onOpen={(result) => {
          if (getRequestWorkspaceId() !== workspaceId) return
          if (result.kind === 'conversation') void openConversationDestination(router, result.id)
          else if (result.kind === 'work')
            router.push({ pathname: '/work/[id]', params: { id: result.id } })
          else if (result.kind === 'automation')
            router.push({ pathname: '/automations', params: { id: result.id } })
          else router.push({ pathname: '/(tabs)/files/file/[id]', params: { id: result.id } })
        }}
      />
      {canSearch && (search.loading || !current) ? <ResourceState theme={theme} loading /> : null}
      {!canSearch ? (
        <ResourceState theme={theme} empty="Search your workspace or type @ followed by a name." />
      ) : null}
      {search.error || work.error || directory.error || agents.error || error ? (
        <ResourceState
          theme={theme}
          error={search.error || work.error || directory.error || agents.error || error}
          onRetry={() => {
            search.retry()
            work.retry()
            directory.retry()
            agents.retry()
          }}
        />
      ) : null}
      <ResourceSheet
        theme={theme}
        title={person?.name || 'Mention'}
        visible={Boolean(person)}
        onClose={() => setPerson(null)}
      >
        <ResourceRow
          theme={theme}
          title="Copy mention"
          onPress={() => {
            if (person)
              void Clipboard.setStringAsync('@' + person.name)
                .then(() => setPerson(null))
                .catch((cause) => setError(String(cause)))
          }}
        />
        <ResourceRow
          theme={theme}
          title="Open conversation"
          onPress={() => {
            if (!person || !workspaceId || getRequestWorkspaceId() !== workspaceId) return
            if ('agentId' in person && person.agentId) {
              router.push({ pathname: '/agent/[id]', params: { id: person.agentId } })
              setPerson(null)
              return
            }
            const scope = workspaceId
            void createDirectMessage(scope, { principalIds: [person.id] })
              .then((room) => {
                if (getRequestWorkspaceId() === scope) {
                  setPerson(null)
                  router.push({ pathname: '/dm/[id]', params: { id: room.conversationId } })
                }
              })
              .catch((cause) => setError(String(cause)))
          }}
        />
      </ResourceSheet>
    </ResourcePage>
  )
}
