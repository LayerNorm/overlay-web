import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../../../hooks/useTheme'
import { useWorkspace } from '../../../../contexts/WorkspaceContext'
import { useAppSession } from '../../../../contexts/AppSessionContext'
import { borderRadius, fontSize, spacing } from '../../../../constants/theme'
import { BottomSheet, MainScreenHeader, TopBarIconButton } from '../../../../components/ui/AppChrome'
import { ListRow, Section } from '../../../../components/ui/primitives'
import { ShareSheet } from '../../../../components/workspace/ShareSheet'
import {
  deleteKnowledgeFile,
  getKnowledgeFile,
  getKnowledgeFileContent,
  listKnowledgeFiles,
  shareKnowledgeFile,
  updateKnowledgeFile,
} from '../../../../services/knowledgeService'
import type { KnowledgeFile } from '@overlay/app-core'

export default function FileDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { activeWorkspaceId, workspacesEnabled } = useWorkspace()
  const { isFeatureEnabled } = useAppSession()
  const sharingEnabled = workspacesEnabled && isFeatureEnabled('resourceSharing') && !!activeWorkspaceId
  const [file, setFile] = useState<KnowledgeFile | null>(null)
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [moveOpen, setMoveOpen] = useState(false)
  const [folders, setFolders] = useState<KnowledgeFile[]>([])

  const loadFile = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    try {
      const data = await getKnowledgeFile(id)
      setFile(data)
      if (data.content !== undefined) {
        setContent(data.content)
      } else if (!data.isStorageBacked) {
        try {
          const text = await getKnowledgeFileContent(id)
          setContent(text)
        } catch {
          setContent('')
        }
      }
    } catch {
      Alert.alert('Error', 'Could not load file')
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadFile()
  }, [loadFile])

  async function handleSave() {
    if (!id || !file) return
    setIsSaving(true)
    try {
      await updateKnowledgeFile(id, { content })
    } catch {
      Alert.alert('Error', 'Could not save file')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRename() {
    const name = renameValue.trim()
    if (!id || !file || !name) return
    setRenameOpen(false)
    try {
      await updateKnowledgeFile(id, { name })
      setFile((current) => (current ? { ...current, name } : current))
    } catch {
      Alert.alert('Error', 'Could not rename file')
    }
  }

  async function openMoveSheet() {
    setMoveOpen(true)
    try {
      const all = await listKnowledgeFiles()
      setFolders(all.filter((entry) => entry.type === 'folder' && entry._id !== id))
    } catch {
      setFolders([])
    }
  }

  async function handleMove(parentId: string | null) {
    if (!id || !file) return
    setMoveOpen(false)
    try {
      await updateKnowledgeFile(id, { parentId })
      setFile((current) => (current ? { ...current, parentId } : current))
    } catch {
      Alert.alert('Error', 'Could not move file')
    }
  }

  function handleDelete() {
    if (!id) return
    Alert.alert('Delete file', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteKnowledgeFile(id)
            router.back()
          } catch {
            Alert.alert('Error', 'Could not delete file')
          }
        },
      },
    ])
  }

  const isTextFile =
    file?.name.endsWith('.txt') ||
    file?.name.endsWith('.md') ||
    file?.name.endsWith('.json') ||
    file?.name.endsWith('.js') ||
    file?.name.endsWith('.ts') ||
    file?.name.endsWith('.tsx') ||
    file?.name.endsWith('.css') ||
    file?.name.endsWith('.html') ||
    file?.name.endsWith('.csv') ||
    false

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  if (!file) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <Text style={{ color: theme.textSecondary }}>File not found</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        blurHeight={insets.top + 52}
        leftSlot={<TopBarIconButton theme={theme} icon="arrow-left" onPress={() => router.back()} />}
        centerSlot={
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            {file.name}
          </Text>
        }
        rightSlot={
          <View style={styles.headerActions}>
            {isTextFile ? (
              <TouchableOpacity
                onPress={handleSave}
                disabled={isSaving}
                style={[styles.saveButtonInline, { opacity: isSaving ? 0.4 : 1 }]}
              >
                <Text style={[styles.saveButtonText, { color: theme.foreground }]}>
                  {isSaving ? 'Saving…' : 'Save'}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TopBarIconButton theme={theme} icon="more-horizontal" onPress={() => setActionsOpen(true)} />
          </View>
        }
      />

      {isTextFile ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 54 }]}
        >
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            placeholder="Enter file content..."
            placeholderTextColor={theme.textDisabled}
            style={[
              styles.editor,
              {
                color: theme.text,
                backgroundColor: theme.surfaceMuted,
                borderColor: theme.border,
              },
            ]}
          />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            styles.centeredPreview,
            { paddingTop: insets.top + 54 },
          ]}
        >
          {file.mimeType?.startsWith('image/') && file.downloadUrl ? (
            <Image
              source={{ uri: file.downloadUrl }}
              style={styles.imagePreview}
              resizeMode="contain"
              alt={file.name}
            />
          ) : (
            <Feather name="file" size={40} color={theme.textSecondary} />
          )}
          <Text style={[styles.binaryHint, { color: theme.textSecondary }]}>
            {file.downloadUrl
              ? 'Preview only — this file type cannot be edited on mobile.'
              : file.isStorageBacked
                ? 'This file is stored externally and cannot be edited on mobile.'
                : 'This file type cannot be edited on mobile.'}
          </Text>
          {file.downloadUrl ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => void WebBrowser.openBrowserAsync(file.downloadUrl!)}
              style={[styles.openButton, { backgroundColor: theme.foreground }]}
            >
              <Feather name="external-link" size={14} color={theme.background} />
              <Text style={[styles.openButtonText, { color: theme.background }]}>Open file</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}

      <BottomSheet
        theme={theme}
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={file.name}
      >
        <Section theme={theme}>
          <ListRow
            theme={theme}
            icon="edit-3"
            title="Rename"
            onPress={() => {
              setActionsOpen(false)
              setRenameValue(file.name)
              setRenameOpen(true)
            }}
          />
          <ListRow
            theme={theme}
            icon="folder"
            title="Move to…"
            onPress={() => {
              setActionsOpen(false)
              void openMoveSheet()
            }}
          />
          <ListRow
            theme={theme}
            icon="share-2"
            title="Share"
            onPress={() => {
              setActionsOpen(false)
              setShareOpen(true)
            }}
          />
          <ListRow
            theme={theme}
            icon="trash-2"
            title="Delete"
            destructive
            onPress={() => {
              setActionsOpen(false)
              handleDelete()
            }}
          />
        </Section>
      </BottomSheet>

      <BottomSheet
        theme={theme}
        visible={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename file"
        headerAction={
          <TouchableOpacity
            onPress={() => void handleRename()}
            disabled={!renameValue.trim()}
            style={{ opacity: renameValue.trim() ? 1 : 0.4 }}
          >
            <Text style={[styles.saveButtonText, { color: theme.foreground }]}>Rename</Text>
          </TouchableOpacity>
        }
      >
        <TextInput
          value={renameValue}
          onChangeText={setRenameValue}
          placeholder="File name"
          placeholderTextColor={theme.textDisabled}
          autoFocus
          style={[
            styles.renameInput,
            { backgroundColor: theme.surfaceMuted, color: theme.text, borderColor: theme.border },
          ]}
        />
      </BottomSheet>

      <BottomSheet
        theme={theme}
        visible={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="Move to…"
      >
        <Section theme={theme}>
          <ListRow
            theme={theme}
            icon="home"
            title="Root"
            subtitle="Top level of your files"
            onPress={() => void handleMove(null)}
          />
          {folders.map((folder) => (
            <ListRow
              key={folder._id}
              theme={theme}
              icon="folder"
              title={folder.name}
              onPress={() => void handleMove(folder._id)}
            />
          ))}
        </Section>
      </BottomSheet>

      <ShareSheet
        visible={shareOpen}
        theme={theme}
        resource={
          sharingEnabled && activeWorkspaceId
            ? { workspaceId: activeWorkspaceId, resourceType: 'file', resourceId: file._id }
            : null
        }
        resourceTitle={file.name}
        onSetPublicVisibility={async (visibility) => {
          const response = await shareKnowledgeFile(file._id, visibility)
          return response.url
        }}
        onClose={() => setShareOpen(false)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'LibreBaskerville',
    textAlign: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  renameInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
  },
  saveButtonInline: {
    paddingHorizontal: 8,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  editor: {
    flex: 1,
    minHeight: 400,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  binaryHint: {
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  centeredPreview: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  imagePreview: {
    width: Dimensions.get('window').width - 32,
    height: Dimensions.get('window').width - 32,
    borderRadius: borderRadius.lg,
  },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  openButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
})
