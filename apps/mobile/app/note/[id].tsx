import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  NativeSyntheticEvent,
  TextInputSelectionChangeEventData
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import { spacing, fontSize, borderRadius } from '../../constants/theme'
import { Note, generateNoteId } from '../../services/types'
import { loadNote, saveNote } from '../../services/noteStorage'
import { DictationAccessoryStrip } from '../../components/voice/DictationAccessoryStrip'
import {
  TextSelectionRange,
  deleteBackwardAtSelection,
  formatTranscriptForInsertion,
  insertTextAtSelection
} from '../../services/textInputEditing'

const NOTE_VOICE_ACCESSORY_ID = 'note-voice-accessory'
const USES_ACCESSORY_STRIP = Platform.OS === 'ios'

export default function NoteEditorScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { theme } = useTheme()

  const [noteTitle, setNoteTitle] = useState('Untitled')
  const [noteBody, setNoteBody] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const noteRef = useRef<Note | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleInputRef = useRef<TextInput>(null)
  const bodyInputRef = useRef<TextInput>(null)
  const bodyTextRef = useRef('')
  const bodySelectionRef = useRef<TextSelectionRange>({ start: 0, end: 0 })

  const {
    isRecording,
    isProcessing,
    error: voiceError,
    startRecording,
    stopRecording,
    toggleRecording
  } = useVoiceInput()

  useEffect(() => {
    bodyTextRef.current = noteBody
  }, [noteBody])

  const performSave = useCallback(async (title: string, content: string) => {
    if (!noteRef.current) return
    setIsSaving(true)
    try {
      await saveNote({
        ...noteRef.current,
        title,
        content,
        updatedAt: Date.now()
      })
    } finally {
      setIsSaving(false)
    }
  }, [])

  const debouncedSave = useCallback((title: string, content: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      performSave(title, content)
    }, 500)
  }, [performSave])

  const syncBodySelection = useCallback((cursor: number) => {
    bodySelectionRef.current = { start: cursor, end: cursor }
    requestAnimationFrame(() => {
      bodyInputRef.current?.setNativeProps({
        selection: { start: cursor, end: cursor }
      })
    })
  }, [])

  const applyBodyEdit = useCallback((nextText: string, cursor: number) => {
    bodyTextRef.current = nextText
    setNoteBody(nextText)
    debouncedSave(noteTitle, nextText)
    syncBodySelection(cursor)
  }, [debouncedSave, noteTitle, syncBodySelection])

  const insertTextInBody = useCallback((text: string) => {
    const edit = insertTextAtSelection(bodyTextRef.current, bodySelectionRef.current, text)
    applyBodyEdit(edit.nextText, edit.nextSelection.start)
  }, [applyBodyEdit])

  const deleteBackwardInBody = useCallback(() => {
    const edit = deleteBackwardAtSelection(bodyTextRef.current, bodySelectionRef.current)
    applyBodyEdit(edit.nextText, edit.nextSelection.start)
  }, [applyBodyEdit])

  const insertTranscriptIntoBody = useCallback((transcript: string) => {
    const selection = bodySelectionRef.current
    const current = bodyTextRef.current
    const formatted = formatTranscriptForInsertion(transcript, current.slice(selection.end))

    if (!formatted) {
      return
    }

    const edit = insertTextAtSelection(current, selection, formatted)
    applyBodyEdit(edit.nextText, edit.nextSelection.start)
  }, [applyBodyEdit])

  const handleMicTap = useCallback(async () => {
    const result = await toggleRecording()
    if (result?.text) {
      insertTranscriptIntoBody(result.text)
    }
  }, [insertTranscriptIntoBody, toggleRecording])

  const handleMicHoldStart = useCallback(async () => {
    if (isProcessing || isRecording) {
      return
    }
    await startRecording()
  }, [isProcessing, isRecording, startRecording])

  const handleMicHoldEnd = useCallback(async () => {
    if (isProcessing) {
      return
    }

    const result = await stopRecording()
    if (result?.text) {
      insertTranscriptIntoBody(result.text)
    }
  }, [insertTranscriptIntoBody, isProcessing, stopRecording])

  const handleBodySelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      bodySelectionRef.current = event.nativeEvent.selection
    },
    []
  )

  useEffect(() => {
    async function initNote(): Promise<void> {
      const noteId = id === 'new' ? generateNoteId() : id
      if (id === 'new') {
        const newNote: Note = {
          id: noteId,
          title: 'Untitled',
          content: '',
          updatedAt: Date.now(),
          createdAt: Date.now(),
          folderId: null
        }
        await saveNote(newNote)
        noteRef.current = newNote
        setNoteTitle('Untitled')
        setNoteBody('')
        bodyTextRef.current = ''
        setIsLoading(false)
        setTimeout(() => {
          titleInputRef.current?.focus()
        }, 100)
      } else {
        const existing = await loadNote(noteId)
        if (existing) {
          noteRef.current = existing
          setNoteTitle(existing.title)
          setNoteBody(existing.content)
          bodyTextRef.current = existing.content
        }
        setIsLoading(false)
      }
    }

    initNote()
  }, [id])

  const handleTitleChange = useCallback((text: string) => {
    setNoteTitle(text)
    debouncedSave(text, bodyTextRef.current)
  }, [debouncedSave])

  const handleBodyChange = useCallback((text: string) => {
    bodyTextRef.current = text
    setNoteBody(text)
    debouncedSave(noteTitle, text)
  }, [debouncedSave, noteTitle])

  const handleTitleSubmit = useCallback(() => {
    bodyInputRef.current?.focus()
  }, [])

  const handleGoBack = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    await performSave(noteTitle, bodyTextRef.current)
    router.back()
  }, [noteTitle, performSave, router])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={handleGoBack} style={styles.backButton} activeOpacity={0.7}>
          <Feather name="chevron-left" size={24} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          {isSaving && (
            <Text style={[styles.savingIndicator, { color: theme.textSecondary }]}>Saving...</Text>
          )}
        </View>

        <TouchableOpacity style={styles.headerAction} activeOpacity={0.7}>
          <Feather name="more-horizontal" size={20} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.editorContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            ref={titleInputRef}
            style={[styles.titleInput, { color: theme.text }]}
            value={noteTitle}
            onChangeText={handleTitleChange}
            placeholder="Untitled"
            placeholderTextColor={theme.textDisabled}
            returnKeyType="next"
            blurOnSubmit={true}
            onSubmitEditing={handleTitleSubmit}
          />

          <TextInput
            ref={bodyInputRef}
            style={[styles.bodyInput, { color: theme.text }]}
            value={noteBody}
            onChangeText={handleBodyChange}
            inputAccessoryViewID={USES_ACCESSORY_STRIP ? NOTE_VOICE_ACCESSORY_ID : undefined}
            placeholder="Start writing..."
            placeholderTextColor={theme.textDisabled}
            multiline
            textAlignVertical="top"
            scrollEnabled={false}
            onSelectionChange={handleBodySelectionChange}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {USES_ACCESSORY_STRIP ? (
        <DictationAccessoryStrip
          accessoryID={NOTE_VOICE_ACCESSORY_ID}
          theme={theme}
          isRecording={isRecording}
          isProcessing={isProcessing}
          error={voiceError}
          onMicTap={handleMicTap}
          onMicHoldStart={handleMicHoldStart}
          onMicHoldEnd={handleMicHoldEnd}
          onInsertText={insertTextInBody}
          onDeleteBackward={deleteBackwardInBody}
          onReturn={() => insertTextInBody('\n')}
        />
      ) : (
        <TouchableOpacity
          style={[
            styles.voiceFab,
            {
              backgroundColor: isRecording
                ? '#EF4444'
                : isProcessing
                  ? theme.surface
                  : theme.buttonBg
            }
          ]}
          onPress={handleMicTap}
          disabled={isProcessing}
          activeOpacity={0.7}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : (
            <Feather
              name={isRecording ? 'square' : 'mic'}
              size={isRecording ? 18 : 22}
              color={isRecording ? '#FFFFFF' : theme.toggleThumb}
            />
          )}
        </TouchableOpacity>
      )}

      {!USES_ACCESSORY_STRIP && (isRecording || voiceError) && (
        <View style={[styles.voiceStatus, { backgroundColor: theme.surface }]}>
          <Text style={[styles.voiceStatusText, { color: isRecording ? '#EF4444' : theme.textSecondary }]}>
            {isRecording ? 'Recording... tap mic to stop' : voiceError}
          </Text>
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1
  },
  backButton: {
    padding: spacing.sm,
    borderRadius: borderRadius.sm
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center'
  },
  savingIndicator: {
    fontSize: fontSize.xs
  },
  headerAction: {
    padding: spacing.sm,
    borderRadius: borderRadius.sm
  },
  editorContainer: {
    flex: 1
  },
  scrollContainer: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1
  },
  titleInput: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  },
  bodyInput: {
    flex: 1,
    fontSize: fontSize.md,
    lineHeight: 24,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    minHeight: 300
  },
  voiceFab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5
  },
  voiceStatus: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 80,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  voiceStatusText: {
    fontSize: fontSize.xs,
    fontWeight: '500'
  }
})
