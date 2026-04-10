import React, { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { IconAction, PanelCard, SectionLabel } from '../../components/ui/PanelPrimitives'
import {
  createKnowledgeFile,
  createMemory,
  deleteKnowledgeFile,
  deleteMemory,
  listKnowledgeFiles,
  listMemories,
  listOutputs,
} from '../../services/knowledgeService'
import type { KnowledgeFile, MemoryRow, OutputSummary } from '../../services/appContracts'

type KnowledgeTab = 'memories' | 'files' | 'outputs'
type OutputFilter = 'all' | 'image' | 'video' | 'files'

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return 'No date'
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function SegmentedTabs({
  activeTab,
  onChange,
}: {
  activeTab: KnowledgeTab
  onChange: (next: KnowledgeTab) => void
}): React.ReactElement {
  const { theme } = useTheme()
  const tabs: KnowledgeTab[] = ['memories', 'files', 'outputs']

  return (
    <View style={[styles.segmented, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {tabs.map((tab) => {
        const active = tab === activeTab
        return (
          <TouchableOpacity
            key={tab}
            onPress={() => onChange(tab)}
            style={[styles.segment, { backgroundColor: active ? theme.text : 'transparent' }]}
          >
            <Text style={[styles.segmentText, { color: active ? theme.surface : theme.textSecondary }]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export default function KnowledgeScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('memories')
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [outputs, setOutputs] = useState<OutputSummary[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [outputFilter, setOutputFilter] = useState<OutputFilter>('all')
  const [showMemoryComposer, setShowMemoryComposer] = useState(false)
  const [memoryDraft, setMemoryDraft] = useState('')
  const [showFileComposer, setShowFileComposer] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const refresh = useCallback(async () => {
    const [nextMemories, nextFiles, nextOutputs] = await Promise.all([
      listMemories().catch(() => []),
      listKnowledgeFiles().catch(() => []),
      listOutputs().catch(() => []),
    ])
    setMemories(nextMemories)
    setFiles(nextFiles)
    setOutputs(nextOutputs)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const filteredMemories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return memories
    return memories.filter((memory) =>
      `${memory.content} ${memory.fullContent} ${memory.source}`.toLowerCase().includes(query),
    )
  }, [memories, searchQuery])

  const filteredFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return files
    return files.filter((file) => file.name.toLowerCase().includes(query))
  }, [files, searchQuery])

  const filteredOutputs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return outputs.filter((output) => {
      if (outputFilter === 'image' && output.type !== 'image') return false
      if (outputFilter === 'video' && output.type !== 'video') return false
      if (outputFilter === 'files' && (output.type === 'image' || output.type === 'video')) return false
      if (!query) return true
      return `${output.fileName || ''} ${output.prompt || ''} ${output.type}`.toLowerCase().includes(query)
    })
  }, [outputFilter, outputs, searchQuery])

  const handleCreateMemory = useCallback(async () => {
    if (!memoryDraft.trim() || isSaving) return
    setIsSaving(true)
    try {
      await createMemory(memoryDraft.trim())
      setMemoryDraft('')
      setShowMemoryComposer(false)
      await refresh()
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, memoryDraft, refresh])

  const handleCreateFile = useCallback(async () => {
    if (!fileName.trim() || isSaving) return
    setIsSaving(true)
    try {
      const created = await createKnowledgeFile({
        name: fileName.trim(),
        content: fileContent,
      })
      setFileName('')
      setFileContent('')
      setShowFileComposer(false)
      await refresh()
      router.push(`/file/${created.id}`)
    } finally {
      setIsSaving(false)
    }
  }, [fileContent, fileName, isSaving, refresh, router])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.titleBlock}>
            <SectionLabel theme={theme}>Knowledge</SectionLabel>
            <Text style={[styles.title, { color: theme.text }]}>Library</Text>
            <Text style={[styles.description, { color: theme.textSecondary }]}>
              Memories, files, and outputs now share the same authenticated Overlay backend as web.
            </Text>
          </View>
          <View style={styles.headerActions}>
            <IconAction
              theme={theme}
              icon={activeTab === 'memories' ? 'plus' : activeTab === 'files' ? 'file-plus' : 'refresh-cw'}
              onPress={() => {
                if (activeTab === 'memories') setShowMemoryComposer((current) => !current)
                else if (activeTab === 'files') setShowFileComposer((current) => !current)
                else void refresh()
              }}
              active={activeTab === 'memories' ? showMemoryComposer : activeTab === 'files' ? showFileComposer : false}
            />
          </View>
        </View>

        <SegmentedTabs activeTab={activeTab} onChange={setActiveTab} />

        <PanelCard theme={theme}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={
              activeTab === 'memories'
                ? 'Search memories'
                : activeTab === 'files'
                  ? 'Search file names'
                  : 'Search outputs'
            }
            placeholderTextColor={theme.textDisabled}
            style={[
              styles.searchInput,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
            ]}
          />

          {activeTab === 'outputs' ? (
            <View style={styles.filterRow}>
              {(['all', 'image', 'video', 'files'] as OutputFilter[]).map((filter) => {
                const active = filter === outputFilter
                return (
                  <TouchableOpacity
                    key={filter}
                    onPress={() => setOutputFilter(filter)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active ? theme.text : theme.background,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text style={[styles.filterChipText, { color: active ? theme.surface : theme.textSecondary }]}>
                      {filter}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          ) : null}
        </PanelCard>

        {activeTab === 'memories' && showMemoryComposer ? (
          <PanelCard theme={theme}>
            <Text style={[styles.composerTitle, { color: theme.text }]}>New memory</Text>
            <TextInput
              multiline
              value={memoryDraft}
              onChangeText={setMemoryDraft}
              placeholder="Capture a durable memory for Overlay."
              placeholderTextColor={theme.textDisabled}
              style={[
                styles.multilineInput,
                { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
              ]}
            />
            <View style={styles.inlineActions}>
              <TouchableOpacity
                onPress={() => {
                  setShowMemoryComposer(false)
                  setMemoryDraft('')
                }}
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  void handleCreateMemory()
                }}
                style={[styles.primaryButton, { backgroundColor: theme.buttonBg }]}
              >
                <Text style={[styles.primaryButtonText, { color: theme.surface }]}>
                  {isSaving ? 'Saving…' : 'Save Memory'}
                </Text>
              </TouchableOpacity>
            </View>
          </PanelCard>
        ) : null}

        {activeTab === 'files' && showFileComposer ? (
          <PanelCard theme={theme}>
            <Text style={[styles.composerTitle, { color: theme.text }]}>New file</Text>
            <TextInput
              value={fileName}
              onChangeText={setFileName}
              placeholder="notes.md"
              placeholderTextColor={theme.textDisabled}
              style={[
                styles.searchInput,
                { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
              ]}
            />
            <TextInput
              multiline
              value={fileContent}
              onChangeText={setFileContent}
              placeholder="Start the file with text content."
              placeholderTextColor={theme.textDisabled}
              style={[
                styles.multilineInput,
                { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
              ]}
            />
            <View style={styles.inlineActions}>
              <TouchableOpacity
                onPress={() => {
                  setShowFileComposer(false)
                  setFileName('')
                  setFileContent('')
                }}
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  void handleCreateFile()
                }}
                style={[styles.primaryButton, { backgroundColor: theme.buttonBg }]}
              >
                <Text style={[styles.primaryButtonText, { color: theme.surface }]}>
                  {isSaving ? 'Creating…' : 'Create File'}
                </Text>
              </TouchableOpacity>
            </View>
          </PanelCard>
        ) : null}

        <PanelCard theme={theme} padded={false}>
          {activeTab === 'memories' ? (
            filteredMemories.length > 0 ? (
              filteredMemories.map((memory, index) => (
                <TouchableOpacity
                  key={memory.key}
                  activeOpacity={0.82}
                  onLongPress={() => {
                    Alert.alert('Delete memory', 'Remove this memory from Overlay?', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                          await deleteMemory(memory.memoryId)
                          await refresh()
                        },
                      },
                    ])
                  }}
                  style={[
                    styles.row,
                    { borderBottomColor: index === filteredMemories.length - 1 ? 'transparent' : theme.border },
                  ]}
                >
                  <View
                    style={[
                      styles.iconBadge,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : theme.background },
                    ]}
                  >
                    <Feather name="bookmark" size={15} color={theme.textSecondary} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
                      {memory.fullContent}
                    </Text>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      {memory.source} · {formatTimestamp(memory.createdAt)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Feather name="bookmark" size={24} color={theme.textSecondary} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No memories yet</Text>
                <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
                  Save durable context here so it appears across Overlay.
                </Text>
              </View>
            )
          ) : null}

          {activeTab === 'files' ? (
            filteredFiles.length > 0 ? (
              filteredFiles.map((file, index) => (
                <TouchableOpacity
                  key={file._id}
                  onPress={() => {
                    if (file.type === 'file') router.push(`/file/${file._id}`)
                  }}
                  onLongPress={() => {
                    Alert.alert('Delete file', `Delete "${file.name}"?`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                          await deleteKnowledgeFile(file._id)
                          await refresh()
                        },
                      },
                    ])
                  }}
                  activeOpacity={0.82}
                  style={[
                    styles.row,
                    { borderBottomColor: index === filteredFiles.length - 1 ? 'transparent' : theme.border },
                  ]}
                >
                  <View
                    style={[
                      styles.iconBadge,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : theme.background },
                    ]}
                  >
                    <Feather
                      name={file.type === 'folder' ? 'folder' : 'file-text'}
                      size={15}
                      color={theme.textSecondary}
                    />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{file.name}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      {file.type} · {formatTimestamp(file.updatedAt)}
                    </Text>
                  </View>
                  {file.type === 'file' ? (
                    <Feather name="chevron-right" size={16} color={theme.textDisabled} />
                  ) : null}
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Feather name="file-plus" size={24} color={theme.textSecondary} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No files yet</Text>
                <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
                  Create a text file here or upload files from the web app.
                </Text>
              </View>
            )
          ) : null}

          {activeTab === 'outputs' ? (
            filteredOutputs.length > 0 ? (
              filteredOutputs.map((output, index) => (
                <TouchableOpacity
                  key={output._id}
                  onPress={() => {
                    if (output.url) {
                      void Linking.openURL(output.url)
                    }
                  }}
                  activeOpacity={output.url ? 0.82 : 1}
                  style={[
                    styles.row,
                    { borderBottomColor: index === filteredOutputs.length - 1 ? 'transparent' : theme.border },
                  ]}
                >
                  <View
                    style={[
                      styles.iconBadge,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : theme.background },
                    ]}
                  >
                    <Feather
                      name={output.type === 'video' ? 'video' : output.type === 'image' ? 'image' : 'file'}
                      size={15}
                      color={theme.textSecondary}
                    />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                      {output.fileName || output.prompt || 'Generated output'}
                    </Text>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      {output.status} · {output.type} · {formatTimestamp(output.completedAt || output.createdAt)}
                    </Text>
                  </View>
                  {output.url ? <Feather name="external-link" size={16} color={theme.textDisabled} /> : null}
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Feather name="image" size={24} color={theme.textSecondary} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No outputs yet</Text>
                <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
                  Generated images, videos, and files from chat and automations appear here.
                </Text>
              </View>
            )
          ) : null}
        </PanelCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  description: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: borderRadius.full,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  searchInput: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  composerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  multilineInput: {
    minHeight: 132,
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  inlineActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryButton: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  primaryButton: {
    minHeight: 42,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  emptyCopy: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
})
