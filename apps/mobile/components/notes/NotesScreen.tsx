import React, { useCallback, useState } from 'react'
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
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useFocusEffect } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { TopBarIconButton } from '../ui/AppChrome'
import { GlassSurface } from '../ui/GlassSurface'
import { loadNotesIndex, createNote, deleteNote } from '../../services/noteStorage'
import type { NoteMeta } from '../../services/types'
import { formatDate } from '../../services/types'

export function NotesScreen(): React.ReactElement {
  const router = useRouter()
  const { theme } = useTheme()
  const { openDrawer } = useDrawer()

  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const refreshNotes = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await loadNotesIndex()
      setNotes(data)
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refreshNotes()
    }, [refreshNotes]),
  )

  const filteredNotes = searchQuery.trim()
    ? notes.filter((n) => n.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : notes

  async function handleCreateNote() {
    try {
      const note = await createNote({ title: 'Untitled', content: '' })
      router.push({ pathname: '/note/[id]', params: { id: note.id } })
    } catch {
      Alert.alert('Error', 'Could not create note')
    }
  }

  async function handleDeleteNote(noteId: string) {
    Alert.alert('Delete note', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNote(noteId)
            setNotes((prev) => prev.filter((n) => n.id !== noteId))
          } catch {
            Alert.alert('Error', 'Could not delete note')
          }
        },
      },
    ])
  }

  return (
    <ScreenWithDrawer
      drawer={
        <DrawerSidebar
          variant="slide"
          theme={theme}
          chats={[]}
          activeChatId={null}
          onSelectChat={() => {}}
          onCreateChat={() => {}}
          notes={notes}
          activeNoteId={null}
          onSelectNote={(id) => router.push({ pathname: '/note/[id]', params: { id } })}
          onCreateNote={handleCreateNote}
        />
      }
    >
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.screenPadding}>
        <View style={[styles.topBar, { backgroundColor: theme.background }]}>
          <TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />
          <Text style={[styles.topBarTitle, { color: theme.text }]}>Notes</Text>
          <TopBarIconButton
            theme={theme}
            icon="plus"
            onPress={() => {
              void handleCreateNote()
            }}
          />
        </View>

        <View style={[styles.searchBar, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search notes"
            placeholderTextColor={theme.textDisabled}
            style={[styles.searchInput, { color: theme.text }]}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Feather name="x" size={16} color={theme.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : filteredNotes.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="book-open" size={40} color={theme.mutedLight} />
            <Text style={[styles.emptyText, { color: theme.mutedLight }]}>
              {searchQuery ? 'No notes match your search' : 'No notes yet'}
            </Text>
            {!searchQuery ? (
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => {
                  void handleCreateNote()
                }}
                style={[styles.createButton, { backgroundColor: theme.foreground }]}
              >
                <Text style={[styles.createButtonText, { color: theme.background }]}>Create a note</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => router.push({ pathname: '/note/[id]', params: { id: item.id } })}
                style={[styles.noteCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
              >
                <View style={styles.noteRow}>
                  <View style={styles.noteCopy}>
                    <Text style={[styles.noteTitle, { color: theme.text }]} numberOfLines={1}>
                      {item.title || 'Untitled'}
                    </Text>
                    <Text style={[styles.noteDate, { color: theme.textSecondary }]}>{formatDate(item.updatedAt)}</Text>
                  </View>
                  <TouchableOpacity
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    onPress={() => handleDeleteNote(item.id)}
                  >
                    <Feather name="trash-2" size={16} color={theme.textSecondary} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>

    </SafeAreaView>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screenPadding: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
  },
  topBarTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    fontFamily: 'LibreBaskerville',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: 0,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingBottom: 80,
  },
  emptyText: {
    fontSize: fontSize.md,
    fontWeight: '400',
  },
  createButton: {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  createButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  listContent: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  noteCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  noteCopy: {
    flex: 1,
    gap: 4,
  },
  noteTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  noteDate: {
    fontSize: fontSize.sm,
  },
})
