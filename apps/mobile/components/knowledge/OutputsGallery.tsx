import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../hooks/useTheme'
import { useRouter } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { EmptyState } from '../ui/AppChrome'
import { listOutputs, deleteOutput, bulkDeleteOutputs } from '../../services/knowledgeService'
import type { OutputSummary } from '@overlay/app-core'

const OUTPUT_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Image', value: 'image' },
  { label: 'Video', value: 'video' },
  { label: 'Files', value: 'files' },
] as const

type OutputFilter = (typeof OUTPUT_FILTERS)[number]['value']

const { width } = Dimensions.get('window')
const IMAGE_SIZE = (width - 48 - 16) / 2

function OutputImageThumb({ url, style }: { url: string; style: object }) {
  const [failed, setFailed] = useState(false)
  if (failed || !url) {
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }]}>
        <Feather name="image" size={24} color="rgba(255,255,255,0.3)" />
      </View>
    )
  }
  return <Image source={{ uri: url }} style={style} onError={() => setFailed(true)} />
}

export function OutputsGallery(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()
  const [outputs, setOutputs] = useState<OutputSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<OutputFilter>('all')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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
    if (filter === 'all') return outputs
    return outputs.filter((o) => {
      if (filter === 'image') return o.type === 'image'
      if (filter === 'video') return o.type === 'video'
      if (filter === 'files') return o.type !== 'image' && o.type !== 'video'
      return true
    })
  }, [outputs, filter])

  const imageOutputs = filtered.filter((o) => o.type === 'image')
  const otherOutputs = filtered.filter((o) => o.type !== 'image')

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
    router.push({ pathname: '/knowledge/output/[id]', params: { id: output._id } })
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {OUTPUT_FILTERS.map((f) => {
          const active = filter === f.value
          return (
            <TouchableOpacity
              key={f.value}
              onPress={() => setFilter(f.value)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? theme.foreground : 'transparent',
                  borderColor: active ? theme.foreground : theme.border,
                },
              ]}
            >
              <Text style={[styles.filterChipText, { color: active ? theme.background : theme.textSecondary }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

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

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : filtered.length === 0 ? (
        <EmptyState
          theme={theme}
          icon="image"
          title="No outputs yet"
          description="Generate images, videos, or files from chat to see them here"
        />
      ) : (
        <FlatList
          data={otherOutputs}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            imageOutputs.length > 0 ? (
              <View style={styles.imageGrid}>
                {imageOutputs.map((item) => {
                  const isSelected = selectedIds.has(item._id)
                  return (
                    <TouchableOpacity
                      key={item._id}
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
                          width: IMAGE_SIZE,
                          height: IMAGE_SIZE,
                        },
                      ]}
                    >
                      <OutputImageThumb url={item.url ?? ''} style={styles.imageThumb} />
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
                })}
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item._id)
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
