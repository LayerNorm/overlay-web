import React, { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SectionList,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../../hooks/useTheme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'
import { NoteMeta, Folder, formatDate, getDateLabel } from '../../services/types'
import { loadNotesIndex, deleteNote } from '../../services/noteStorage'
import {
  loadNoteFolders,
  createNoteFolder,
  deleteNoteFolder,
  toggleNoteFolderExpanded
} from '../../services/folderStorage'

interface NoteRowProps {
  note: NoteMeta
  theme: ReturnType<typeof useTheme>['theme']
  onPress: () => void
  onDelete: () => void
}

function NoteRow({ note, theme, onPress, onDelete }: NoteRowProps): React.ReactElement {
  const handleDelete = (): void => {
    Alert.alert(
      'Delete Note',
      `Are you sure you want to delete "${note.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            onDelete()
          }
        }
      ]
    )
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={handleDelete}
      activeOpacity={0.7}
      style={[styles.noteRow, { backgroundColor: theme.background }]}
    >
      <View style={styles.noteRowContent}>
        <View style={styles.noteRowIcon}>
          <Feather name="file-text" size={16} color={theme.textSecondary} />
        </View>
        <View style={styles.noteRowText}>
          <Text style={[styles.noteTitle, { color: theme.text }]} numberOfLines={1}>
            {note.title || 'Untitled'}
          </Text>
          <Text style={[styles.noteDate, { color: theme.textSecondary }]}>
            {formatDate(note.updatedAt)}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={theme.textDisabled} />
      </View>
    </TouchableOpacity>
  )
}

interface FolderRowProps {
  folder: Folder
  noteCount: number
  theme: ReturnType<typeof useTheme>['theme']
  onToggle: () => void
  onDelete: () => void
}

function FolderRow({ folder, noteCount, theme, onToggle, onDelete }: FolderRowProps): React.ReactElement {
  const handleDelete = (): void => {
    Alert.alert(
      'Delete Folder',
      `Are you sure you want to delete "${folder.name}"? Notes inside will be moved to root.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            onDelete()
          }
        }
      ]
    )
  }

  return (
    <TouchableOpacity
      onPress={onToggle}
      onLongPress={handleDelete}
      activeOpacity={0.7}
      style={[styles.folderRow, { backgroundColor: theme.background }]}
    >
      <View style={styles.folderRowContent}>
        <Feather
          name={folder.isExpanded ? 'chevron-down' : 'chevron-right'}
          size={14}
          color={theme.textSecondary}
        />
        <Feather name="folder" size={16} color={theme.textSecondary} />
        <Text style={[styles.folderName, { color: theme.text }]} numberOfLines={1}>
          {folder.name}
        </Text>
        <Text style={[styles.folderCount, { color: theme.textDisabled }]}>
          {noteCount}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

export default function NotesScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()

  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [showSearch, setShowSearch] = useState(false)

  const refreshData = useCallback(async () => {
    const [loadedNotes, loadedFolders] = await Promise.all([
      loadNotesIndex(),
      loadNoteFolders()
    ])
    setNotes(loadedNotes.sort((a, b) => b.updatedAt - a.updatedAt))
    setFolders(loadedFolders)
    setIsLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      refreshData()
    }, [refreshData])
  )

  const handleNewNote = (): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push('/note/new')
  }

  const handleOpenNote = useCallback((id: string) => {
    router.push(`/note/${id}`)
  }, [router])

  const handleDeleteNote = useCallback(async (id: string) => {
    await deleteNote(id)
    await refreshData()
  }, [refreshData])

  const handleCreateFolder = useCallback(async () => {
    Alert.prompt(
      'New Folder',
      'Enter folder name',
      async (name) => {
        if (name?.trim()) {
          await createNoteFolder(name.trim())
          await refreshData()
        }
      },
      'plain-text',
      'New Folder'
    )
  }, [refreshData])

  const handleToggleFolder = useCallback(async (folderId: string) => {
    await toggleNoteFolderExpanded(folderId)
    await refreshData()
  }, [refreshData])

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    await deleteNoteFolder(folderId)
    await refreshData()
  }, [refreshData])

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes
    const lowerQuery = searchQuery.toLowerCase()
    return notes.filter((n) => n.title.toLowerCase().includes(lowerQuery))
  }, [notes, searchQuery])

  const rootFolders = useMemo(
    () => folders.filter((f) => f.parentId === null),
    [folders]
  )

  const rootNotes = useMemo(
    () => filteredNotes.filter((n) => !n.folderId),
    [filteredNotes]
  )

  const sections = useMemo(() => {
    const result: { title: string; data: (NoteMeta | { type: 'folder'; folder: Folder; notes: NoteMeta[] })[] }[] = []

    if (rootFolders.length > 0 && !searchQuery) {
      const folderItems = rootFolders.map((folder) => ({
        type: 'folder' as const,
        folder,
        notes: filteredNotes.filter((n) => n.folderId === folder.id)
      }))
      result.push({ title: 'FOLDERS', data: folderItems })
    }

    const grouped: Record<string, NoteMeta[]> = {}
    for (const note of rootNotes) {
      const label = getDateLabel(note.updatedAt)
      if (!grouped[label]) grouped[label] = []
      grouped[label].push(note)
    }

    for (const [label, groupNotes] of Object.entries(grouped)) {
      result.push({ title: label, data: groupNotes })
    }

    return result
  }, [rootFolders, rootNotes, filteredNotes, searchQuery])

  const hasNotes = notes.length > 0

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Notes</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setShowSearch(!showSearch)}
            style={styles.headerButton}
            activeOpacity={0.7}
          >
            <Feather name="search" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleCreateFolder}
            style={styles.headerButton}
            activeOpacity={0.7}
          >
            <Feather name="folder-plus" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.newButton, { backgroundColor: theme.buttonBg }]}
            onPress={handleNewNote}
            activeOpacity={0.7}
          >
            <Feather name="plus" size={20} color={theme.surface} />
          </TouchableOpacity>
        </View>
      </View>

      {showSearch && (
        <View style={[styles.searchContainer, { borderBottomColor: theme.border }]}>
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search notes..."
            placeholderTextColor={theme.textDisabled}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Feather name="x" size={16} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {!hasNotes && !isLoading ? (
        <View style={styles.emptyContent}>
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.surface }]}>
              <Feather name="file-text" size={32} color={theme.textSecondary} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No notes yet</Text>
            <Text style={[styles.emptyDescription, { color: theme.textSecondary }]}>
              Create your first note to get started
            </Text>
            <TouchableOpacity
              style={[styles.emptyButton, { backgroundColor: theme.buttonBg }]}
              onPress={handleNewNote}
              activeOpacity={0.7}
            >
              <Text style={[styles.emptyButtonText, { color: theme.surface }]}>New Note</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => {
            if ('type' in item && item.type === 'folder') return `folder-${item.folder.id}`
            return (item as NoteMeta).id
          }}
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: theme.background }]}>
              <Text style={[styles.sectionHeaderText, { color: theme.textSecondary }]}>
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            if ('type' in item && item.type === 'folder') {
              return (
                <View>
                  <FolderRow
                    folder={item.folder}
                    noteCount={item.notes.length}
                    theme={theme}
                    onToggle={() => handleToggleFolder(item.folder.id)}
                    onDelete={() => handleDeleteFolder(item.folder.id)}
                  />
                  {item.folder.isExpanded && item.notes.map((note) => (
                    <View key={note.id} style={styles.folderNoteIndent}>
                      <NoteRow
                        note={note}
                        theme={theme}
                        onPress={() => handleOpenNote(note.id)}
                        onDelete={() => handleDeleteNote(note.id)}
                      />
                    </View>
                  ))}
                </View>
              )
            }

            const note = item as NoteMeta
            return (
              <NoteRow
                note={note}
                theme={theme}
                onPress={() => handleOpenNote(note.id)}
                onDelete={() => handleDeleteNote(note.id)}
              />
            )
          }}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '600'
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  headerButton: {
    padding: spacing.sm
  },
  newButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center'
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    marginBottom: spacing.sm
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: spacing.xs
  },
  listContent: {
    paddingBottom: 100
  },
  sectionHeader: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    paddingTop: spacing.lg
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5
  },
  noteRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md
  },
  noteRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  noteRowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  noteRowText: {
    flex: 1,
    gap: 2
  },
  noteTitle: {
    fontSize: fontSize.md,
    fontWeight: '500'
  },
  noteDate: {
    fontSize: fontSize.xs
  },
  folderRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md
  },
  folderRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  folderName: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '500'
  },
  folderCount: {
    fontSize: fontSize.xs
  },
  folderNoteIndent: {
    paddingLeft: spacing.xl
  },
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600'
  },
  emptyDescription: {
    fontSize: fontSize.sm,
    textAlign: 'center'
  },
  emptyButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.md
  },
  emptyButtonText: {
    fontSize: fontSize.md,
    fontWeight: '500'
  }
})
