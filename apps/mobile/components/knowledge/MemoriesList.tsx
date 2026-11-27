import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../../hooks/useTheme'
import { useRouter } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { SearchField, EmptyState, BottomSheet } from '../ui/AppChrome'
import { useDrawer } from '../../contexts/DrawerContext'
import {
  listMemories,
  createMemory,
  deleteMemory,
  bulkDeleteMemories,
} from '../../services/knowledgeService'
import type { MemoryRow } from '@overlay/app-core'

type MemoryHeaderAction = 'new' | 'import' | 'selectMemories'

export function MemoriesList({
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
  const { searchNonce } = useDrawer()
  const searchInputRef = useRef<TextInput>(null)
  const flatListRef = useRef<FlatList<MemoryRow>>(null)
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)

  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [addText, setAddText] = useState('')

  const [importSheetOpen, setImportSheetOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await listMemories()
      setMemories(data)
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  // Focus the inline search field when the sidebar search button is pressed.
  useEffect(() => {
    if (searchNonce === 0) return
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchNonce])

  const filtered = searchQuery.trim()
    ? memories.filter((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : memories

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

    const action = headerAction.type as MemoryHeaderAction
    if (action === 'new') {
      setAddSheetOpen(true)
    } else if (action === 'import') {
      setImportSheetOpen(true)
    } else if (action === 'selectMemories') {
      setSelectMode(true)
    }
  }, [headerAction])

  async function handleAddMemory() {
    const text = addText.trim()
    if (!text || isSaving) return
    setIsSaving(true)
    try {
      await createMemory(text)
      setAddText('')
      setAddSheetOpen(false)
      await refresh()
    } catch {
      Alert.alert('Error', 'Could not save memory')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleImportMemory() {
    const text = importText.trim()
    if (!text || isSaving) return
    setIsSaving(true)
    try {
      await createMemory(text)
      setImportText('')
      setImportSheetOpen(false)
      await refresh()
    } catch {
      Alert.alert('Error', 'Could not import memory')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(memoryId: string) {
    Alert.alert('Delete memory', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMemory(memoryId)
            setMemories((prev) => prev.filter((m) => m.memoryId !== memoryId))
          } catch {
            Alert.alert('Error', 'Could not delete memory')
          }
        },
      },
    ])
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    Alert.alert('Delete memories', `Delete ${selectedIds.size} memories?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await bulkDeleteMemories([...selectedIds])
            exitSelectMode()
            await refresh()
          } catch {
            Alert.alert('Error', 'Could not delete memories')
          }
        },
      },
    ])
  }

  function openMemory(memory: MemoryRow) {
    router.push(`/files/memory/${encodeURIComponent(memory.memoryId)}`)
  }

  const listHeader = (
    <View style={{ paddingTop: topInset, gap: spacing.md }}>
      <SearchField
        ref={searchInputRef}
        theme={theme}
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search memories"
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
            <TouchableOpacity
              onPress={() => setImportSheetOpen(true)}
              style={[styles.toolbarButton, { borderColor: theme.border }]}
            >
              <Feather name="download" size={13} color={theme.textSecondary} />
              <Text style={[styles.toolbarButtonText, { color: theme.textSecondary }]}>Import</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setAddSheetOpen(true)}
              style={[styles.toolbarButton, { borderColor: theme.border, backgroundColor: theme.foreground }]}
            >
              <Feather name="plus" size={13} color={theme.background} />
              <Text style={[styles.toolbarButtonText, { color: theme.background }]}>New</Text>
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
            icon="box"
            title={searchQuery ? 'No memories match your search' : 'No memories yet'}
            description={searchQuery ? 'Try a different search term' : 'Add or import your first memory'}
            action={
              !searchQuery ? (
                <TouchableOpacity
                  onPress={() => setAddSheetOpen(true)}
                  style={[styles.emptyAction, { backgroundColor: theme.foreground }]}
                >
                  <Text style={[styles.emptyActionText, { color: theme.background }]}>Add your first memory</Text>
                </TouchableOpacity>
              ) : undefined
            }
          />
        </>
      ) : (
        <FlatList
          ref={flatListRef}
          data={filtered}
          keyExtractor={(item) => item.memoryId}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item.memoryId)
            return (
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => {
                  if (selectMode) {
                    toggleSelect(item.memoryId)
                  } else {
                    openMemory(item)
                  }
                }}
                onLongPress={() => {
                  if (!selectMode) setSelectMode(true)
                  toggleSelect(item.memoryId)
                }}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.surfaceElevated,
                    borderColor: isSelected ? theme.foreground : theme.border,
                  },
                ]}
              >
                <View style={styles.cardRow}>
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
                  <Text style={[styles.cardText, { color: theme.text }]} numberOfLines={3}>
                    {item.content}
                  </Text>
                  {!selectMode && (
                    <TouchableOpacity
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      onPress={() => handleDelete(item.memoryId)}
                    >
                      <Feather name="trash-2" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            )
          }}
        />
      )}

      {/* Add Memory Sheet */}
      <BottomSheet
        theme={theme}
        visible={addSheetOpen}
        onClose={() => {
          setAddSheetOpen(false)
          setAddText('')
        }}
        title="New Memory"
        headerAction={
          <TouchableOpacity
            onPress={handleAddMemory}
            disabled={!addText.trim() || isSaving}
            style={[styles.sheetAction, { opacity: !addText.trim() || isSaving ? 0.4 : 1 }]}
          >
            <Text style={[styles.sheetActionText, { color: theme.foreground }]}>
              {isSaving ? 'Saving…' : 'Save'}
            </Text>
          </TouchableOpacity>
        }
      >
        <TextInput
          value={addText}
          onChangeText={setAddText}
          placeholder="Enter memory content..."
          placeholderTextColor={theme.textDisabled}
          multiline
          textAlignVertical="top"
          style={[
            styles.textArea,
            { backgroundColor: theme.surfaceMuted, color: theme.text, borderColor: theme.border },
          ]}
        />
      </BottomSheet>

      {/* Import Memory Sheet */}
      <BottomSheet
        theme={theme}
        visible={importSheetOpen}
        onClose={() => {
          setImportSheetOpen(false)
          setImportText('')
        }}
        title="Import Memory"
        headerAction={
          <TouchableOpacity
            onPress={handleImportMemory}
            disabled={!importText.trim() || isSaving}
            style={[styles.sheetAction, { opacity: !importText.trim() || isSaving ? 0.4 : 1 }]}
          >
            <Text style={[styles.sheetActionText, { color: theme.foreground }]}>
              {isSaving ? 'Importing…' : 'Import'}
            </Text>
          </TouchableOpacity>
        }
      >
        <Text style={[styles.importHint, { color: theme.textSecondary }]}>
          Paste the text you want to import as a memory.
        </Text>
        <TextInput
          value={importText}
          onChangeText={setImportText}
          placeholder="Paste content here..."
          placeholderTextColor={theme.textDisabled}
          multiline
          textAlignVertical="top"
          style={[
            styles.textArea,
            { backgroundColor: theme.surfaceMuted, color: theme.text, borderColor: theme.border },
          ]}
        />
      </BottomSheet>
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
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  cardText: {
    flex: 1,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  emptyAction: {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  emptyActionText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  textArea: {
    minHeight: 160,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  sheetAction: {
    paddingHorizontal: spacing.sm,
  },
  sheetActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  importHint: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
})
