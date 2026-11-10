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

export function SearchScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [sourceKind, setSourceKind] = useState<'file' | 'memory'>('file')
  const [results, setResults] = useState<KnowledgeSearchChunk[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = query.trim()
  const canSearch = trimmed.length >= 2

  // Convex-native in Phase 1: workspace-wide search and global mentions.
  useEffect(() => {
    let cancelled = false
    setResults([])
    setError(null)
    setLoading(canSearch)
    if (!canSearch) return

    const timer = setTimeout(() => {
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
  }, [trimmed, sourceKind, canSearch])

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        leftSlot={<TopBarIconButton theme={theme} icon="arrow-left" onPress={() => router.back()} />}
        centerSlot={<Text style={{ color: theme.text }}>Files & memories</Text>}
      />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 68, paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <SearchField theme={theme} value={query} onChangeText={setQuery} placeholder="Search files & memories" autoFocus />
        <SegmentedControl
          theme={theme}
          value={sourceKind}
          options={[{ value: 'file', label: 'Files' }, { value: 'memory', label: 'Memories' }]}
          onChange={setSourceKind}
        />
        {loading ? <ActivityIndicator color={theme.textSecondary} /> : error ? (
          <EmptyState theme={theme} icon="alert-circle" title="Search unavailable" description={error} />
        ) : !canSearch ? (
          <EmptyState theme={theme} icon="search" title="Search files & memories" description="Enter at least two characters." />
        ) : results.length === 0 ? (
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
