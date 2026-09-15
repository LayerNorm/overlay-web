import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { spacing, fontSize } from '../../constants/theme'
import {
  EmptyState,
  MainScreenHeader,
  SearchField,
  TopBarIconButton,
} from '../ui/AppChrome'
import { ListRow, Section } from '../ui/primitives'
import type { FeatherIconName } from '../ui/AppIcon'
import {
  searchWorkspace,
  WORKSPACE_SEARCH_MIN_QUERY_LENGTH,
  type WorkspaceSearchKind,
  type WorkspaceSearchResult,
} from '../../services/searchService'
import { OverlayApiError } from '../../services/appApi'

const SEARCH_DEBOUNCE_MS = 250

const KIND_LABELS: Record<WorkspaceSearchKind, string> = {
  conversation: 'Chats',
  file: 'Files',
  project: 'Projects',
  knowledge_base: 'Knowledge bases',
  automation: 'Automations',
  agent: 'Agents',
}

const KIND_ICONS: Record<WorkspaceSearchKind, { sf: string; feather: FeatherIconName }> = {
  conversation: { sf: 'bubble.left', feather: 'message-circle' },
  file: { sf: 'doc', feather: 'file' },
  project: { sf: 'tray.2', feather: 'layers' },
  knowledge_base: { sf: 'books.vertical', feather: 'database' },
  automation: { sf: 'bolt.badge.clock', feather: 'zap' },
  agent: { sf: 'sparkles', feather: 'cpu' },
}

/** Maps a search result to a mobile route; null = no surface yet (Phase 1+). */
function routeForResult(result: WorkspaceSearchResult): string | null {
  switch (result.kind) {
    case 'conversation':
      return `/chat/${result.id}`
    case 'file':
      return `/(tabs)/knowledge/file/${result.id}`
    case 'project':
      return '/(tabs)/projects'
    case 'knowledge_base':
      return `/knowledge-base/${result.id}`
    case 'automation':
      return '/(tabs)/automations'
    case 'agent':
      return `/agent/${result.id}`
    default:
      return null
  }
}

export function SearchScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WorkspaceSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const trimmed = query.trim()
  const canSearch = trimmed.length >= WORKSPACE_SEARCH_MIN_QUERY_LENGTH

  useEffect(() => {
    if (!canSearch) {
      setResults([])
      setError(null)
      setIsSearching(false)
      return
    }

    const seq = ++requestSeq.current
    setIsSearching(true)
    const timer = setTimeout(() => {
      void searchWorkspace(trimmed)
        .then((response) => {
          if (seq !== requestSeq.current) return
          setResults(response.results ?? [])
          setError(null)
        })
        .catch((nextError: unknown) => {
          if (seq !== requestSeq.current) return
          setResults([])
          setError(
            nextError instanceof OverlayApiError || nextError instanceof Error
              ? nextError.message
              : 'Search failed',
          )
        })
        .finally(() => {
          if (seq === requestSeq.current) {
            setIsSearching(false)
          }
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [trimmed, canSearch])

  const grouped = useMemo(() => {
    const byKind = new Map<WorkspaceSearchKind, WorkspaceSearchResult[]>()
    for (const result of results) {
      const list = byKind.get(result.kind) ?? []
      list.push(result)
      byKind.set(result.kind, list)
    }
    return [...byKind.entries()]
  }, [results])

  const handleResultPress = useCallback(
    (result: WorkspaceSearchResult) => {
      const route = routeForResult(result)
      if (!route) return
      Keyboard.dismiss()
      router.push(route as Parameters<typeof router.push>[0])
    },
    [router],
  )

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        leftSlot={
          <TopBarIconButton theme={theme} icon="arrow-left" onPress={() => router.back()} />
        }
        centerSlot={
          <View style={styles.headerSearch}>
            <SearchField
              theme={theme}
              value={query}
              onChangeText={setQuery}
              placeholder="Search Overlay"
              autoFocus
            />
          </View>
        }
        rightSlot={
          isSearching ? (
            <View style={styles.headerSpinner}>
              <ActivityIndicator size="small" color={theme.textSecondary} />
            </View>
          ) : undefined
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 66, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!canSearch ? (
          <View style={styles.hintWrap}>
            <Text style={[styles.hint, { color: theme.textSecondary }]}>
              Search across chats, files, projects, automations, and more.
            </Text>
          </View>
        ) : error ? (
          <EmptyState
            theme={theme}
            icon="alert-circle"
            title="Search unavailable"
            description={error}
          />
        ) : !isSearching && results.length === 0 ? (
          <EmptyState
            theme={theme}
            icon="search"
            title="No results"
            description={`Nothing matched “${trimmed}” in this workspace.`}
          />
        ) : (
          grouped.map(([kind, items]) => (
            <Section key={kind} theme={theme} label={KIND_LABELS[kind] ?? kind}>
              {items.map((result) => {
                const route = routeForResult(result)
                const icons = KIND_ICONS[result.kind] ?? KIND_ICONS.file
                return (
                  <ListRow
                    key={`${result.kind}:${result.id}`}
                    theme={theme}
                    title={result.title || 'Untitled'}
                    subtitle={result.snippet || result.subtitle}
                    icon={icons.feather}
                    iconSfSymbol={icons.sf}
                    showChevron={route !== null}
                    disabled={route === null}
                    accessory={
                      result.sharedVia ? (
                        <Text style={[styles.sharedTag, { color: theme.textDisabled }]}>
                          Shared
                        </Text>
                      ) : undefined
                    }
                    onPress={() => handleResultPress(result)}
                  />
                )
              })}
            </Section>
          ))
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  headerSearch: {
    flex: 1,
    width: '100%',
  },
  headerSpinner: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.lg,
  },
  hintWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  hint: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  sharedTag: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
})
