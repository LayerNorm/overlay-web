import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Image } from 'expo-image'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../hooks/useTheme'
import { useRouter } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { EmptyState, SearchField } from '../ui/AppChrome'
import { useDrawer } from '../../contexts/DrawerContext'
import { listOutputs, deleteOutput, bulkDeleteOutputs } from '../../services/knowledgeService'
import type { OutputSummary } from '@overlay/app-core'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { useAuth } from '../../contexts/AuthContext'

function resolveOutputUri(rawUrl: string | undefined): string {
  if (!rawUrl) return ''
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  if (rawUrl.startsWith('/')) return `${AUTH_BASE_URL}${rawUrl}`
  return rawUrl
}

type OutputFilter = 'all' | 'image' | 'video' | 'files'
type OutputHeaderAction = 'selectOutputs' | 'outputAll' | 'outputImage' | 'outputVideo' | 'outputFiles'

const { width } = Dimensions.get('window')
const IMAGE_SIZE = (width - 48 - 16) / 2

function OutputImageThumb({
  url,
  style,
  accessToken,
  fallbackIcon = 'image',
  placeholderBg,
  placeholderFg,
}: {
  url: string
  style: object
  accessToken: string | null
  fallbackIcon?: React.ComponentProps<typeof Feather>['name']
  placeholderBg?: string
  placeholderFg?: string
}) {
  const [failed, setFailed] = useState(false)
  const uri = resolveOutputUri(url)
  if (failed || !uri) {
    return (
      <View
        style={[
          style,
          {
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: placeholderBg ?? 'rgba(127,127,127,0.1)',
          },
        ]}
      >
        <Feather name={fallbackIcon} size={24} color={placeholderFg ?? 'rgba(127,127,127,0.5)'} />
      </View>
    )
  }
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
  return (
    <Image
      source={{ uri, headers }}
      style={style}
      contentFit="cover"
      transition={150}
      cachePolicy="memory-disk"
      alt="Generated output"
      onError={(event) => {
        console.warn('[OutputImageThumb] image load failed', { uri, error: event?.error })
        setFailed(true)
      }}
    />
  )
}

export function OutputsGallery({
  headerAction,
  hideInlineToolbar = false,
  topInset = 0,
}: {
  headerAction?: { type: string; nonce: number } | null
  hideInlineToolbar?: boolean
  topInset?: number
}): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()
  const { session } = useAuth()
  const accessToken = session?.accessToken ?? null
  const { searchNonce } = useDrawer()
  const searchInputRef = useRef<TextInput>(null)
  const flatListRef = useRef<FlatList<OutputSummary>>(null)
  const [outputs, setOutputs] = useState<OutputSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<OutputFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (searchNonce === 0) return
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchNonce])

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const type = filter === 'all' ? undefined : filter
      const data = await listOutputs({ type })
      setOutputs(data)
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [filter])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const filtered = useMemo(() => {
    const byType = filter === 'all'
      ? outputs
      : outputs.filter((o) => {
          if (filter === 'image') return o.type === 'image'
          if (filter === 'video') return o.type === 'video'
          if (filter === 'files') return o.type !== 'image' && o.type !== 'video'
          return true
        })
    const q = searchQuery.trim().toLowerCase()
    if (!q) return byType
    return byType.filter((o) => {
      const haystack = [o.type, (o as { name?: string }).name ?? '', (o as { prompt?: string }).prompt ?? '']
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [outputs, filter, searchQuery])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  useEffect(() => {
    if (!headerAction) return

    const action = headerAction.type as OutputHeaderAction
    if (action === 'selectOutputs') {
      setSelectMode(true)
    } else if (action === 'outputAll') {
      setFilter('all')
    } else if (action === 'outputImage') {
      setFilter('image')
    } else if (action === 'outputVideo') {
      setFilter('video')
    } else if (action === 'outputFiles') {
      setFilter('files')
    }
  }, [headerAction])

  async function handleDelete(outputId: string) {
    Alert.alert('Delete output', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteOutput(outputId)
            setOutputs((prev) => prev.filter((o) => o._id !== outputId))
          } catch {
            Alert.alert('Error', 'Could not delete output')
          }
        },
      },
    ])
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    Alert.alert('Delete outputs', `Delete ${selectedIds.size} outputs?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await bulkDeleteOutputs([...selectedIds])
            exitSelectMode()
            await refresh()
          } catch {
            Alert.alert('Error', 'Could not delete outputs')
          }
        },
      },
    ])
  }

  function openOutput(output: OutputSummary) {
    router.push(`/files/output/${encodeURIComponent(output._id)}`)
  }

  const listHeader = (
    <View style={{ paddingTop: topInset, gap: spacing.md }}>
      <SearchField
        ref={searchInputRef}
        theme={theme}
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search outputs"
      />
      {(!hideInlineToolbar || selectMode) ? (
      <View style={styles.toolbar}>
        {selectMode ? (
          <View style={styles.toolbarRow}>
            <TouchableOpacity onPress={exitSelectMode} style={[styles.toolbarButton, { borderColor: theme.border }]}>
              <Text style={[styles.toolbarButtonText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleBulkDelete}
              disabled={selectedIds.size === 0}
              style={[
                styles.toolbarButton,
                { borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.08)' },
                selectedIds.size === 0 && { opacity: 0.4 },
              ]}
            >
              <Feather name="trash-2" size={13} color="#EF4444" />
              <Text style={[styles.toolbarButtonText, { color: '#EF4444' }]}>
                Delete ({selectedIds.size})
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.toolbarRow}>
            <TouchableOpacity
              onPress={() => setSelectMode(true)}
              style={[styles.toolbarButton, { borderColor: theme.border }]}
            >
              <Feather name="check-square" size={13} color={theme.textSecondary} />
              <Text style={[styles.toolbarButtonText, { color: theme.textSecondary }]}>Select</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={refresh} style={[styles.toolbarButton, { borderColor: theme.border }]}>
              <Feather name="refresh-cw" size={13} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
      </View>
      ) : null}
    </View>
  )

  return (
    <View style={styles.container}>
      {isLoading ? (
        <>
          {listHeader}
          <View style={styles.centered}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        </>
      ) : filtered.length === 0 ? (
        <>
          {listHeader}
          <EmptyState
            theme={theme}
            icon="image"
            title="No outputs yet"
            description="Generate images, videos, or files from chat to see them here"
          />
        </>
      ) : (
        <FlatList
          ref={flatListRef}
          data={filtered}
          keyExtractor={(item) => item._id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item._id)
            const isMedia = item.type === 'image' || item.type === 'video'
            if (isMedia) {
              return (
                <TouchableOpacity
                  activeOpacity={0.82}
                  onPress={() => {
                    if (selectMode) toggleSelect(item._id)
                    else openOutput(item)
                  }}
                  onLongPress={() => {
                    if (!selectMode) setSelectMode(true)
                    toggleSelect(item._id)
                  }}
                  style={[
                    styles.imageCell,
                    {
                      borderColor: isSelected ? theme.foreground : theme.border,
                      backgroundColor: theme.surfaceMuted,
                      height: IMAGE_SIZE,
                    },
                  ]}
                >
                  <OutputImageThumb
                    url={item.url ?? ''}
                    style={styles.imageThumb}
                    accessToken={accessToken}
                    fallbackIcon={item.type === 'video' ? 'film' : 'image'}
                    placeholderBg={theme.surfaceMuted}
                    placeholderFg={theme.textSecondary}
                  />
                  {item.type === 'video' && (
                    <View style={styles.videoBadge}>
                      <Feather name="play" size={14} color="#ffffff" />
                    </View>
                  )}
                  {selectMode && (
                    <View
                      style={[
                        styles.imageCheckbox,
                        {
                          borderColor: isSelected ? theme.foreground : theme.border,
                          backgroundColor: isSelected ? theme.foreground : 'rgba(0,0,0,0.4)',
                        },
                      ]}
                    >
                      {isSelected && <Feather name="check" size={12} color={theme.background} />}
                    </View>
                  )}
                  {item.status === 'pending' && (
                    <View style={styles.pendingOverlay}>
                      <ActivityIndicator size="small" />
                    </View>
                  )}
                </TouchableOpacity>
              )
            }

            return (
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => {
                  if (selectMode) toggleSelect(item._id)
                  else openOutput(item)
                }}
                onLongPress={() => {
                  if (!selectMode) setSelectMode(true)
                  toggleSelect(item._id)
                }}
                style={[
                  styles.outputRow,
                  {
                    backgroundColor: theme.surfaceElevated,
                    borderColor: isSelected ? theme.foreground : theme.border,
                  },
                ]}
              >
                <View style={styles.outputRowInner}>
                  {selectMode && (
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: isSelected ? theme.foreground : theme.border,
                          backgroundColor: isSelected ? theme.foreground : 'transparent',
                        },
                      ]}
                    >
                      {isSelected && <Feather name="check" size={12} color={theme.background} />}
                    </View>
                  )}
                  <View style={styles.outputIconWrap}>
                    <Feather
                      name={item.type === 'video' ? 'film' : 'file'}
                      size={18}
                      color={theme.textSecondary}
                    />
                  </View>
                  <View style={styles.outputCopy}>
                    <Text style={[styles.outputPrompt, { color: theme.text }]} numberOfLines={1}>
                      {item.prompt || item.fileName || 'Untitled'}
                    </Text>
                    <Text style={[styles.outputMeta, { color: theme.textSecondary }]}>
                      {item.modelId} · {item.status}
                    </Text>
                  </View>
                </View>
                {!selectMode && (
                  <TouchableOpacity
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    onPress={() => handleDelete(item._id)}
                  >
                    <Feather name="trash-2" size={16} color={theme.textSecondary} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            )
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: 4,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  toolbar: {
    paddingTop: 4,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  toolbarButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  listContent: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  imageCell: {
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  imageThumb: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageCheckbox: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
  },
  outputRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outputIconWrap: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  outputCopy: {
    flex: 1,
    gap: 2,
  },
  outputPrompt: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  outputMeta: {
    fontSize: fontSize.sm,
  },
})
