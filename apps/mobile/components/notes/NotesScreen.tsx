import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useFocusEffect } from 'expo-router'
import { BlurView } from 'expo-blur'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { GlassSurface } from '../ui/GlassSurface'
import { loadNotesIndex, createNote, deleteNote } from '../../services/noteStorage'
import type { NoteMeta } from '../../services/types'

type Section = {
  title: string
  data: NoteMeta[]
}

function getSectionForDate(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days < 7) return 'Previous 7 Days'
  if (days < 30) return 'Previous 30 Days'

  const date = new Date(timestamp)
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return monthNames[date.getMonth()]
}

function formatNoteDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function groupNotesByDate(notes: NoteMeta[]): Section[] {
  const groups = new Map<string, NoteMeta[]>()

  notes.forEach((note) => {
    const section = getSectionForDate(note.updatedAt)
    if (!groups.has(section)) {
      groups.set(section, [])
    }
    groups.get(section)!.push(note)
  })

  const sectionOrder = ['Previous 7 Days', 'Previous 30 Days']
  const monthOrder = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const sortedSections: Section[] = []

  sectionOrder.forEach((title) => {
    if (groups.has(title)) {
      sortedSections.push({ title, data: groups.get(title)! })
      groups.delete(title)
    }
  })

  monthOrder.forEach((month) => {
    if (groups.has(month)) {
      sortedSections.push({ title: month, data: groups.get(month)! })
      groups.delete(month)
    }
  })

  groups.forEach((data, title) => {
    sortedSections.push({ title, data })
  })

  return sortedSections
}

export function NotesScreen(): React.ReactElement {
  const router = useRouter()
  const { theme, isDark } = useTheme()

  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  // Prevent re-navigating to the last note every time the notes array updates
  const hasCheckedLastNote = useRef(false)

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

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes
    return notes.filter((n) => n.title.toLowerCase().includes(searchQuery.toLowerCase()))
  }, [notes, searchQuery])

  const sections = useMemo(() => groupNotesByDate(filteredNotes), [filteredNotes])

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

  const handleOpenNote = useCallback(async (noteId: string) => {
    // Track last opened note
    try {
      await AsyncStorage.setItem('overlay:last-note-id', noteId)
    } catch {
      // ignore
    }
    router.push({ pathname: '/note/[id]', params: { id: noteId } })
  }, [router])

  // On first load, check if we should restore the last-opened note.
  // Guard with a ref so this only fires once — not every time notes refreshes.
  useEffect(() => {
    if (hasCheckedLastNote.current || notes.length === 0) return
    hasCheckedLastNote.current = true

    const checkLastNote = async () => {
      try {
        const lastNoteId = await AsyncStorage.getItem('overlay:last-note-id')
        if (lastNoteId && notes.find(n => n.id === lastNoteId)) {
          router.push({ pathname: '/note/[id]', params: { id: lastNoteId } })
        }
      } catch {
        // ignore
      }
    }
    void checkLastNote()
  }, [notes, router])

  const renderNoteItem = ({ item }: { item: NoteMeta }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => handleOpenNote(item.id)}
      style={[styles.noteCard, { backgroundColor: theme.surface }]}
    >
      <View style={styles.noteRow}>
        <View style={styles.noteCopy}>
          <View style={styles.noteTitleRow}>
            <Text style={[styles.noteTitle, { color: theme.text }]} numberOfLines={1}>
              {item.title || 'Untitled'}
            </Text>
            {item.isLocked && (
              <Ionicons name="lock-closed" size={14} color={theme.textSecondary} style={styles.lockIcon} />
            )}
          </View>
          <Text style={[styles.noteDate, { color: theme.textSecondary }]}>
            {formatNoteDate(item.updatedAt)}
          </Text>
        </View>
        <TouchableOpacity
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={() => handleDeleteNote(item.id)}
        >
          <Feather name="trash-2" size={16} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )

  const renderSectionHeader = ({ section }: { section: Section }) => (
    <Text style={[styles.sectionHeader, { color: theme.text }]}>
      {section.title}
    </Text>
  )

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Notes</Text>
        <TouchableOpacity style={styles.headerButton}>
          <Ionicons name="ellipsis-horizontal" size={24} color={theme.text} />
        </TouchableOpacity>
      </View>

      {/* Notes Count */}
      <Text style={[styles.notesCount, { color: theme.textSecondary }]}>
        {filteredNotes.length} {filteredNotes.length === 1 ? 'Note' : 'Notes'}
      </Text>

      {/* Main Content */}
      <View style={styles.content}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : filteredNotes.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="book-open" size={48} color={theme.mutedLight} />
            <Text style={[styles.emptyText, { color: theme.mutedLight }]}>
              {searchQuery ? 'No notes match your search' : 'No notes yet'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity
                style={[styles.createButton, { backgroundColor: theme.accent }]}
                onPress={handleCreateNote}
              >
                <Text style={[styles.createButtonText, { color: theme.background }]}>
                  Create a note
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={renderNoteItem}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled={false}
          />
        )}
      </View>

      {/* Bottom Search Bar with Glass Effect */}
      <BlurView
        intensity={80}
        tint={isDark ? 'dark' : 'light'}
        style={styles.bottomBar}
      >
        <SafeAreaView edges={['bottom']} style={styles.bottomBarSafeArea}>
          <View style={styles.bottomBarContent}>
            <GlassSurface
              interactive
              style={[
                styles.searchBar,
                {
                  backgroundColor: searchFocused ? theme.surface : theme.glassBg,
                  borderColor: searchFocused ? theme.border : theme.glassBorder,
                },
              ]}
            >
              <Ionicons name="search" size={18} color={theme.textSecondary} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search"
                placeholderTextColor={theme.textDisabled}
                style={[styles.searchInput, { color: theme.text }]}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity>
                  <Ionicons name="mic" size={20} color={theme.textSecondary} />
                </TouchableOpacity>
              )}
            </GlassSurface>

            <TouchableOpacity
              style={[styles.newNoteButton, { backgroundColor: theme.accent }]}
              onPress={handleCreateNote}
            >
              <Ionicons name="create-outline" size={22} color={theme.background} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </BlurView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  notesCount: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  content: {
    flex: 1,
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
    paddingBottom: 120,
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
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  sectionHeader: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  noteCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  noteCopy: {
    flex: 1,
    gap: 2,
  },
  noteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  noteTitle: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  lockIcon: {
    marginLeft: 2,
  },
  noteDate: {
    fontSize: fontSize.sm,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bottomBarSafeArea: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  bottomBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: 0,
  },
  newNoteButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
