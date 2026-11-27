import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../hooks/useTheme'
import { loadNotesIndex, createNote } from '../../services/noteStorage'
import type { NoteMeta } from '../../services/types'
import { NoteEditor } from './NoteEditor'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'

export function NotesEditorScreen(): React.ReactElement {
  const { theme } = useTheme()

  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const didChooseInitialNote = useRef(false)

  const loadNotes = useCallback(async () => {
    try {
      const data = await loadNotesIndex()
      setNotes(data)
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes, refreshKey])

  const handleSelectNote = useCallback((noteId: string) => {
    setActiveNoteId(noteId)
    // Track last opened note
    void AsyncStorage.setItem('overlay:last-note-id', noteId)
  }, [])

  const handleCreateNote = useCallback(async () => {
    try {
      const note = await createNote({ title: 'Untitled', content: '' })
      setNotes((prev) => [note, ...prev])
      setActiveNoteId(note.id)
      void AsyncStorage.setItem('overlay:last-note-id', note.id)
    } catch {
      Alert.alert('Error', 'Could not create note')
    }
  }, [])

  // Choose the initial note once. Edits update the notes index, but should not
  // steal focus back to the previously opened note.
  useEffect(() => {
    if (isLoading || didChooseInitialNote.current) return

    const openLastNote = async () => {
      didChooseInitialNote.current = true
      try {
        const lastNoteId = await AsyncStorage.getItem('overlay:last-note-id')
        if (lastNoteId && notes.find((n) => n.id === lastNoteId)) {
          setActiveNoteId(lastNoteId)
          return
        }
      } catch {
        // ignore
      }
      // If no last note or not found, create a new one if no notes exist
      if (notes.length === 0) {
        await handleCreateNote()
      } else if (notes.length > 0) {
        setActiveNoteId(notes[0].id)
      }
    }
    void openLastNote()
  }, [handleCreateNote, isLoading, notes])

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
          activeNoteId={activeNoteId}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
        />
      }
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {activeNoteId ? (
          <NoteEditor
            noteId={activeNoteId}
            onTitleChange={(newTitle) => {
              // Optimistically update notes list in sidebar
              setNotes((prev) =>
                prev.map((n) =>
                  n.id === activeNoteId ? { ...n, title: newTitle, updatedAt: Date.now() } : n
                )
              )
            }}
            onDelete={() => {
              setNotes((prev) => prev.filter((n) => n.id !== activeNoteId))
              setActiveNoteId(null)
              setRefreshKey((k) => k + 1)
            }}
            onCreateNew={handleCreateNote}
          />
        ) : (
          <View style={styles.emptyState}>
            <NoteEditor.EmptyState onCreate={handleCreateNote} />
          </View>
        )}
      </View>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
  },
})
