import React, { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import {
  EmptyState,
  MainScreenHeader,
  SearchField,
  SegmentedControl,
  TopBarIconButton,
} from '../ui/AppChrome'
import { ListRow } from '../ui/primitives'
import { searchKnowledge, type KnowledgeSearchChunk } from '../../services/knowledgeService'
import { searchWorkspace, type WorkspaceSearchResult } from '../../services/searchService'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { openConversationDestination } from '../../lib/notificationRouting'

export function SearchScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const { activeWorkspaceId } = useWorkspace()
  const nativeReady = useNativeDataReady()
  const [sourceKind, setSourceKind] = useState<'workspace' | 'file' | 'memory'>('workspace')
  const [results, setResults] = useState<KnowledgeSearchChunk[]>([])
  const [workspaceResults, setWorkspaceResults] = useState<WorkspaceSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = query.trim()
  const canSearch = trimmed.length >= 2

  useEffect(() => {
    let cancelled = false
    setResults([])
    setWorkspaceResults([])
    setError(null)
    setLoading(canSearch && nativeReady && Boolean(activeWorkspaceId))
    if (!canSearch || !nativeReady || !activeWorkspaceId) return

    const timer = setTimeout(() => {
      if (sourceKind === 'workspace') {
        void searchWorkspace(trimmed).then(response => { if (!cancelled) setWorkspaceResults(response.results) })
          .catch(() => { if (!cancelled) setError('Search is unavailable. Please try again.') })
          .finally(() => { if (!cancelled) setLoading(false) })
        return
      }
      void searchKnowledge(trimmed, sourceKind)
        .then((response) => {
          if (!cancelled) setResults(response.chunks)
        })
        .catch((nextError: unknown) => {
          if (!cancelled) setError(nextError instanceof Error ? nextError.message : 'Search failed')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, sourceKind, canSearch, nativeReady, activeWorkspaceId])

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        leftSlot={<TopBarIconButton theme={theme} icon="arrow-left" onPress={() => router.back()} />}
        centerSlot={<Text style={{ color: theme.text }}>Search</Text>}
      />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 68, paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <SearchField theme={theme} value={query} onChangeText={setQuery} placeholder="Search workspace" autoFocus />
        <SegmentedControl
          theme={theme}
          value={sourceKind}
          options={[{ value: 'workspace', label: 'Workspace' }, { value: 'file', label: 'Files' }, { value: 'memory', label: 'Memories' }]}
          onChange={setSourceKind}
        />
        {loading ? <ActivityIndicator color={theme.textSecondary} /> : error ? (
          <EmptyState theme={theme} icon="alert-circle" title="Search unavailable" description={error} />
        ) : !canSearch ? (
          <EmptyState theme={theme} icon="search" title="Search your workspace" description="Enter at least two characters." />
        ) : sourceKind === 'workspace' && workspaceResults.length > 0 ? workspaceResults.map(result => (
          <ListRow key={result.kind + ':' + result.id} theme={theme} title={result.title} subtitle={result.snippet} onPress={() => {
            if (result.kind === 'conversation') void openConversationDestination(router, result.id)
            else if (result.kind === 'file') router.push(('/files/file/' + encodeURIComponent(result.id)) as Parameters<typeof router.push>[0])
            else if (result.kind === 'automation') router.push('/(tabs)/automations')
          }} />
        )) : results.length === 0 ? (
          <EmptyState theme={theme} icon="search" title="No results" description="Try a different search." />
        ) : results.map((result) => (
          <ListRow
            key={result.sourceKind + ':' + result.sourceId + ':' + result.chunkIndex}
            theme={theme}
            title={result.title || (sourceKind === 'file' ? 'File' : 'Memory')}
            subtitle={result.text}
            icon={sourceKind === 'file' ? 'file-text' : 'bookmark'}
            onPress={() => router.push(('/files/' + (sourceKind === 'file' ? 'file' : 'memory') + '/' + encodeURIComponent(result.sourceId)) as Parameters<typeof router.push>[0])}
          />
        ))}
      </ScrollView>
    </View>
  )
}
