import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { ShareSheet } from '../workspace/ShareSheet'
import * as DocumentPicker from 'expo-document-picker'
import { getInfoAsync, readAsStringAsync, EncodingType } from 'expo-file-system/legacy'
import {
  listKnowledgeFiles,
  createKnowledgeFile,
  createKnowledgeFolder,
  deleteKnowledgeFile,
  bulkDeleteKnowledgeFiles,
  getUploadUrl,
  uploadToR2,
  createFileWithStorage,
  searchTextInFiles,
  shareKnowledgeFile,
} from '../../services/knowledgeService'
import type { KnowledgeFile } from '@overlay/app-core'

interface TreeNode extends KnowledgeFile {
  depth: number
  isExpanded: boolean
  hasChildren: boolean
}

type FileHeaderAction = 'new' | 'selectFiles' | 'uploadFile' | 'uploadFolder'

function buildTree(
  files: KnowledgeFile[],
  expandedIds: Set<string>,
  searchQuery: string,
  contentMatchIds?: Set<string> | null,
): TreeNode[] {
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase()
    const matches = files.filter(
      (f) => f.name.toLowerCase().includes(q) || (contentMatchIds?.has(f._id) ?? false),
    )
    return matches.map((f) => ({ ...f, depth: 0, isExpanded: false, hasChildren: false }))
  }

  const map = new Map<string, KnowledgeFile[]>()
  for (const f of files) {
    const parent = f.parentId ?? 'root'
    if (!map.has(parent)) map.set(parent, [])
    map.get(parent)!.push(f)
  }

  const result: TreeNode[] = []
  const visit = (parentId: string | null, depth: number) => {
    const children = map.get(parentId ?? 'root') ?? []
    for (const child of children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })) {
      const childIds = map.get(child._id) ?? []
      const isExpanded = expandedIds.has(child._id)
      result.push({
        ...child,
        depth,
        isExpanded,
        hasChildren: childIds.length > 0,
      })
      if (isExpanded && child.type === 'folder') {
        visit(child._id, depth + 1)
      }
    }
  }
  visit(null, 0)
  return result
}

export function FilesTree({
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
  const { isFeatureEnabled } = useAppSession()
  const { activeWorkspaceId, workspacesEnabled } = useWorkspace()
  const sharingEnabled = workspacesEnabled && isFeatureEnabled('resourceSharing') && !!activeWorkspaceId
  const [shareTarget, setShareTarget] = useState<KnowledgeFile | null>(null)
  const searchInputRef = useRef<TextInput>(null)
  const flatListRef = useRef<FlatList<TreeNode>>(null)
  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [contentMatchIds, setContentMatchIds] = useState<Set<string> | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isUploading, setIsUploading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const [createSheetOpen, setCreateSheetOpen] = useState(false)
  const [createType, setCreateType] = useState<'file' | 'folder'>('file')
  const [createName, setCreateName] = useState('')
  const [createParentId, setCreateParentId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await listKnowledgeFiles()
      setFiles(data)
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

  useEffect(() => {
    if (searchNonce === 0) return
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchNonce])

  // Server-side full-text search — debounced; matches union with the
  // client-side name filter so "search files" covers file contents too
  // (same endpoint web's KnowledgeView uses).
  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < 2) {
      setContentMatchIds(null)
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      const fileIds = files.filter((f) => f.type !== 'folder').map((f) => f._id)
      if (fileIds.length === 0) return
      void searchTextInFiles(fileIds, query)
        .then((response) => {
          if (!cancelled) {
            setContentMatchIds(new Set(response.matches.map((match) => match.fileId)))
          }
        })
        .catch(() => {
          if (!cancelled) setContentMatchIds(null)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [searchQuery, files])

  const tree = useMemo(
    () => buildTree(files, expandedIds, searchQuery, contentMatchIds),
    [files, expandedIds, searchQuery, contentMatchIds],
  )

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  const handleUploadFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      })
      if (result.canceled) return
      const asset = result.assets[0]
      if (!asset) return

      setIsUploading(true)
      const fileInfo = await getInfoAsync(asset.uri)
      const sizeBytes = fileInfo.exists ? fileInfo.size || 0 : 0
      const mimeType = asset.mimeType || 'application/octet-stream'

      const { r2Key, presignedUrl } = await getUploadUrl({
        name: asset.name,
        mimeType,
        sizeBytes,
      })

      const fileContent = await readAsStringAsync(asset.uri, {
        encoding: EncodingType.Base64,
      })
      const binaryString = atob(fileContent)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      await uploadToR2(presignedUrl, bytes, mimeType)
      await createFileWithStorage({
        name: asset.name,
        r2Key,
        sizeBytes,
        parentId: createParentId,
      })

      setCreateParentId(null)
      await refresh()
    } catch (err) {
      console.error('[FileUpload] Error:', err)
      Alert.alert('Upload failed', String(err instanceof Error ? err.message : 'Could not upload file'))
    } finally {
      setIsUploading(false)
    }
  }, [createParentId, refresh])

  useEffect(() => {
    if (!headerAction) return

    const action = headerAction.type as FileHeaderAction
    if (action === 'new') {
      openCreateSheet('file')
    } else if (action === 'selectFiles') {
      setSelectMode(true)
    } else if (action === 'uploadFile') {
      void handleUploadFile()
    } else if (action === 'uploadFolder') {
      Alert.alert('Upload folder', 'Folder upload is not available on this device yet. Upload individual files for now.')
    }
  }, [headerAction, handleUploadFile])

  async function handleCreate() {
    const name = createName.trim()
    if (!name || isCreating) return
    setIsCreating(true)
    try {
      if (createType === 'folder') {
        await createKnowledgeFolder({ name, parentId: createParentId })
      } else {
        await createKnowledgeFile({ name, parentId: createParentId })
      }
      setCreateName('')
      setCreateSheetOpen(false)
      setCreateParentId(null)
      await refresh()
    } catch {
      Alert.alert('Error', `Could not create ${createType}`)
    } finally {
      setIsCreating(false)
    }
  }

  async function handleDelete(fileId: string) {
    Alert.alert('Delete file', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteKnowledgeFile(fileId)
            setFiles((prev) => prev.filter((f) => f._id !== fileId))
          } catch {
            Alert.alert('Error', 'Could not delete file')
          }
        },
      },
    ])
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    Alert.alert('Delete files', `Delete ${selectedIds.size} items?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await bulkDeleteKnowledgeFiles([...selectedIds])
            exitSelectMode()
            await refresh()
          } catch {
            Alert.alert('Error', 'Could not delete files')
          }
        },
      },
    ])
  }

  function openFile(file: KnowledgeFile) {
    if (file.type === 'folder') {
      toggleExpand(file._id)
    } else {
      router.push(`/files/file/${encodeURIComponent(file._id)}`)
    }
  }

  function openCreateSheet(type: 'file' | 'folder', parentId?: string | null) {
    setCreateType(type)
    setCreateParentId(parentId ?? null)
    setCreateName('')
    setCreateSheetOpen(true)
  }

  const listHeader = (
    <View style={{ paddingTop: topInset, gap: spacing.md }}>
      <SearchField ref={searchInputRef} theme={theme} value={searchQuery} onChangeText={setSearchQuery} placeholder="Search files" />

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
              onPress={handleUploadFile}
              disabled={isUploading}
              style={[styles.toolbarButton, { borderColor: theme.border }]}
            >
              <Feather name="upload" size={13} color={theme.textSecondary} />
              <Text style={[styles.toolbarButtonText, { color: theme.textSecondary }]}>
                {isUploading ? 'Uploading…' : 'Upload'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => openCreateSheet('folder')}
              style={[styles.toolbarButton, { borderColor: theme.border }]}
            >
              <Feather name="folder-plus" size={13} color={theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => openCreateSheet('file')}
              style={[styles.toolbarButton, { borderColor: theme.border, backgroundColor: theme.foreground }]}
            >
              <Feather name="file-plus" size={13} color={theme.background} />
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
      ) : tree.length === 0 ? (
        <>
          {listHeader}
          <EmptyState
          theme={theme}
          icon="file-text"
          title={searchQuery ? 'No files match your search' : 'No files yet'}
          description={searchQuery ? 'Try a different search term' : 'Create a file or upload from your device'}
          action={
            !searchQuery ? (
              <View style={styles.emptyActions}>
                <TouchableOpacity
                  onPress={() => openCreateSheet('file')}
                  style={[styles.emptyAction, { backgroundColor: theme.foreground }]}
                >
                  <Text style={[styles.emptyActionText, { color: theme.background }]}>New file</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleUploadFile}
                  style={[styles.emptyAction, { borderColor: theme.border, borderWidth: 1 }]}
                >
                  <Text style={[styles.emptyActionText, { color: theme.text }]}>Upload file</Text>
                </TouchableOpacity>
              </View>
            ) : undefined
          }
        />
        </>
      ) : (
        <FlatList
          ref={flatListRef}
          data={tree}
          keyExtractor={(item) => item._id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item._id)
            return (
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => {
                  if (selectMode) {
                    toggleSelect(item._id)
                  } else {
                    openFile(item)
                  }
                }}
                onLongPress={() => {
                  if (!selectMode) setSelectMode(true)
                  toggleSelect(item._id)
                }}
                style={[
                  styles.fileRow,
                  {
                    paddingLeft: 12 + item.depth * 20,
                    backgroundColor: isSelected ? theme.surfaceSubtle : theme.surfaceElevated,
                    borderColor: isSelected ? theme.foreground : theme.border,
                  },
                ]}
              >
                <View style={styles.fileRowInner}>
                  {selectMode ? (
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
                  ) : item.type === 'folder' ? (
                    <Feather
                      name={item.isExpanded ? 'chevron-down' : 'chevron-right'}
                      size={16}
                      color={theme.textSecondary}
                    />
                  ) : (
                    <Feather name="file-text" size={16} color={theme.textSecondary} />
                  )}
                  <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                {!selectMode && item.type === 'file' && (
                  <View style={styles.fileRowActions}>
                    {sharingEnabled ? (
                      <TouchableOpacity
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        onPress={() => setShareTarget(item)}
                        accessibilityLabel={`Share ${item.name}`}
                      >
                        <Feather name="share-2" size={15} color={theme.textSecondary} />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      onPress={() => handleDelete(item._id)}
                    >
                      <Feather name="trash-2" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            )
          }}
        />
      )}

      {/* Create File/Folder Sheet */}
      <BottomSheet
        theme={theme}
        visible={createSheetOpen}
        onClose={() => {
          setCreateSheetOpen(false)
          setCreateName('')
          setCreateParentId(null)
        }}
        title={`New ${createType === 'folder' ? 'Folder' : 'File'}`}
        headerAction={
          <TouchableOpacity
            onPress={handleCreate}
            disabled={!createName.trim() || isCreating}
            style={[styles.sheetAction, { opacity: !createName.trim() || isCreating ? 0.4 : 1 }]}
          >
            <Text style={[styles.sheetActionText, { color: theme.foreground }]}>
              {isCreating ? 'Creating…' : 'Create'}
            </Text>
          </TouchableOpacity>
        }
      >
        <TextInput
          value={createName}
          onChangeText={setCreateName}
          placeholder={createType === 'folder' ? 'Folder name' : 'filename.txt'}
          placeholderTextColor={theme.textDisabled}
          autoFocus
          style={[
            styles.nameInput,
            { backgroundColor: theme.surfaceMuted, color: theme.text, borderColor: theme.border },
          ]}
        />
      </BottomSheet>

      <ShareSheet
        visible={shareTarget !== null}
        theme={theme}
        resource={
          shareTarget && activeWorkspaceId
            ? { workspaceId: activeWorkspaceId, resourceType: 'file', resourceId: shareTarget._id }
            : null
        }
        resourceTitle={shareTarget?.name ?? ''}
        onSetPublicVisibility={
          shareTarget
            ? async (visibility) => {
                const response = await shareKnowledgeFile(shareTarget._id, visibility)
                return response.url
              }
            : undefined
        }
        onClose={() => setShareTarget(null)}
      />
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
    gap: 2,
    paddingTop: spacing.sm,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    paddingRight: 12,
  },
  fileRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fileRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  fileName: {
    flex: 1,
    fontSize: fontSize.md,
  },
  emptyActions: {
    flexDirection: 'row',
    gap: spacing.sm,
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
  nameInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
  },
  sheetAction: {
    paddingHorizontal: spacing.sm,
  },
  sheetActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
})
