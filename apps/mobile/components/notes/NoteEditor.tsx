import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { EnrichedMarkdownText, EnrichedMarkdownTextInput } from 'react-native-enriched-markdown'
import type { EnrichedMarkdownTextInputInstance, MarkdownStyle } from 'react-native-enriched-markdown'
import { fontSize, spacing, borderRadius } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { loadNote, saveNote } from '../../services/noteStorage'
import {
  normalizeHtmlForMobileMarkdown,
  toStoredHtml,
} from '../../services/noteContentFormat'
import type { Note } from '../../services/types'
import { MainScreenHeader, TopBarIconButton } from '../ui/AppChrome'
import { FloatingSearchBar } from '../ui/FloatingSearchBar'

const SAVE_DEBOUNCE_MS = 1200
const HEADER_HEIGHT = 56

type SelectionRange = {
  start: number
  end: number
}

type MarkdownTransform = (markdown: string, selection: SelectionRange) => {
  markdown: string
  selection?: SelectionRange
}

function lineBounds(markdown: string, selection: SelectionRange): SelectionRange {
  const lineStart = markdown.lastIndexOf('\n', Math.max(selection.start - 1, 0)) + 1
  const nextLineBreak = markdown.indexOf('\n', selection.end)
  return {
    start: lineStart,
    end: nextLineBreak === -1 ? markdown.length : nextLineBreak,
  }
}

function wrapSelection(prefix: string, suffix = prefix): MarkdownTransform {
  return (markdown, selection) => {
    const selected = markdown.slice(selection.start, selection.end)
    if (!selected) {
      // No selection — insert markers and drop the caret between them.
      const insert = `${prefix}${suffix}`
      return {
        markdown: `${markdown.slice(0, selection.start)}${insert}${markdown.slice(selection.end)}`,
        selection: {
          start: selection.start + prefix.length,
          end: selection.start + prefix.length,
        },
      }
    }
    const insert = `${prefix}${selected}${suffix}`
    return {
      markdown: `${markdown.slice(0, selection.start)}${insert}${markdown.slice(selection.end)}`,
      selection: {
        start: selection.start + prefix.length,
        end: selection.start + prefix.length + selected.length,
      },
    }
  }
}

const LIST_OR_HEADING_PREFIX = /^(#{1,6}\s+|[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+|>\s+)/

function prefixSelectedLines(prefix: string): MarkdownTransform {
  return (markdown, selection) => {
    const bounds = lineBounds(markdown, selection)
    const selectedLines = markdown.slice(bounds.start, bounds.end)
    const lines = selectedLines.split('\n')
    const transformed = lines
      .map((line) => {
        const leadingMatch = /^\s*/.exec(line)
        const indent = leadingMatch ? leadingMatch[0] : ''
        const rest = line.slice(indent.length).replace(LIST_OR_HEADING_PREFIX, '')
        return `${indent}${prefix}${rest}`
      })
      .join('\n')
    const newMarkdown = `${markdown.slice(0, bounds.start)}${transformed}${markdown.slice(bounds.end)}`
    // For an empty selection, drop the caret at the end of the (now-prefixed) line.
    if (selection.start === selection.end) {
      const firstLineLen = transformed.indexOf('\n')
      const caret = bounds.start + (firstLineLen === -1 ? transformed.length : firstLineLen)
      return { markdown: newMarkdown, selection: { start: caret, end: caret } }
    }
    return {
      markdown: newMarkdown,
      selection: { start: bounds.start, end: bounds.start + transformed.length },
    }
  }
}

function numberedSelectedLines(): MarkdownTransform {
  return (markdown, selection) => {
    const bounds = lineBounds(markdown, selection)
    const selectedLines = markdown.slice(bounds.start, bounds.end)
    const lines = selectedLines.split('\n')
    let index = 0
    const transformed = lines
      .map((line) => {
        const leadingMatch = /^\s*/.exec(line)
        const indent = leadingMatch ? leadingMatch[0] : ''
        const rest = line.slice(indent.length).replace(LIST_OR_HEADING_PREFIX, '')
        index += 1
        return `${indent}${index}. ${rest}`
      })
      .join('\n')
    const newMarkdown = `${markdown.slice(0, bounds.start)}${transformed}${markdown.slice(bounds.end)}`
    if (selection.start === selection.end) {
      const firstLineLen = transformed.indexOf('\n')
      const caret = bounds.start + (firstLineLen === -1 ? transformed.length : firstLineLen)
      return { markdown: newMarkdown, selection: { start: caret, end: caret } }
    }
    return {
      markdown: newMarkdown,
      selection: { start: bounds.start, end: bounds.start + transformed.length },
    }
  }
}

function heading(level: 1 | 2 | 3): MarkdownTransform {
  return prefixSelectedLines(`${'#'.repeat(level)} `)
}

interface NoteEditorProps {
  noteId: string
  onTitleChange?: (title: string) => void
  onCreateNew?: () => void
  onDelete?: () => void
}

export function NoteEditor({ noteId, onTitleChange, onCreateNew }: NoteEditorProps): React.ReactElement {
  const router = useRouter()
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer, drawerVisible } = useDrawer()
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [markdownContent, setMarkdownContent] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [selection, setSelection] = useState<SelectionRange>({ start: 0, end: 0 })

  const editorRef = useRef<EnrichedMarkdownTextInputInstance>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<string>('')

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const loaded = await loadNote(noteId)
      if (loaded) {
        setNote(loaded)
        setTitle(loaded.title)
        const md = normalizeHtmlForMobileMarkdown(loaded.content ?? '')
        contentRef.current = md
        setMarkdownContent(md)
      } else {
        Alert.alert('Not found', 'This note could not be found.', [
          { text: 'OK', onPress: () => router.back() },
        ])
      }
    } catch {
      Alert.alert('Error', 'Could not load note.')
    } finally {
      setIsLoading(false)
    }
  }, [noteId, router])

  useEffect(() => {
    void load()
  }, [load])

  const performSave = useCallback(
    async (currentTitle: string, currentMarkdown: string) => {
      if (!note) return
      try {
        const saved = await saveNote({ ...note, title: currentTitle, content: toStoredHtml(currentMarkdown) })
        setNote(saved)
      } catch {
        // retain dirty state; will retry on next keystroke
      }
    },
    [note],
  )

  const scheduleContentSave = useCallback(
    (markdown: string) => {
      contentRef.current = markdown
      setMarkdownContent(markdown)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        void performSave(title, markdown)
      }, SAVE_DEBOUNCE_MS)
    },
    [title, performSave],
  )

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        void performSave(text, contentRef.current)
      }, SAVE_DEBOUNCE_MS)
      onTitleChange?.(text)
    },
    [onTitleChange, performSave],
  )

  const handleOpenDrawer = useCallback(() => {
    editorRef.current?.blur()
    Keyboard.dismiss()
    setIsEditing(false)
    openDrawer()
  }, [openDrawer])

  const focusEditor = useCallback(() => {
    setIsEditing(true)
    requestAnimationFrame(() => editorRef.current?.focus())
  }, [])

  const enterReadMode = useCallback(() => {
    Keyboard.dismiss()
    setIsEditing(false)
  }, [])

  const applyMarkdownTransform = useCallback(
    async (transform: MarkdownTransform) => {
      setIsEditing(true)
      const current = await editorRef.current?.getMarkdown().catch(() => contentRef.current) ?? contentRef.current
      const result = transform(current, selection)
      contentRef.current = result.markdown
      setMarkdownContent(result.markdown)
      editorRef.current?.setValue(result.markdown)
      if (result.selection) {
        editorRef.current?.setSelection(result.selection.start, result.selection.end)
        setSelection(result.selection)
      }
      scheduleContentSave(result.markdown)
      requestAnimationFrame(() => editorRef.current?.focus())
    },
    [scheduleContentSave, selection],
  )

  const insertCodeBlock = useCallback(() => {
    void applyMarkdownTransform((markdown, currentSelection) => {
      const selected = markdown.slice(currentSelection.start, currentSelection.end)
      const insert = `\`\`\`\n${selected}\n\`\`\``
      const innerStart = currentSelection.start + 4
      return {
        markdown: `${markdown.slice(0, currentSelection.start)}${insert}${markdown.slice(currentSelection.end)}`,
        selection: selected
          ? { start: innerStart, end: innerStart + selected.length }
          : { start: innerStart, end: innerStart },
      }
    })
  }, [applyMarkdownTransform])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (drawerVisible) {
      editorRef.current?.blur()
      Keyboard.dismiss()
      setIsEditing(false)
    }
  }, [drawerVisible])

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height))
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  const toolbarBottomInset =
    keyboardHeight > 0 ? Math.max(keyboardHeight - 8, 0) : Math.max(insets.bottom, 0)

  const runInlineCommand = useCallback((command: () => void) => {
    setIsEditing(true)
    requestAnimationFrame(() => {
      command()
      editorRef.current?.focus()
    })
  }, [])

  const handleInsertLink = useCallback(() => {
    if (Platform.OS === 'ios' && typeof Alert.prompt === 'function') {
      Alert.prompt('Add link', 'Enter a URL', (url) => {
        const trimmed = url.trim()
        if (!trimmed) return
        runInlineCommand(() => editorRef.current?.setLink(trimmed))
      }, 'plain-text', 'https://')
      return
    }
    void applyMarkdownTransform(wrapSelection('[', '](https://)'))
  }, [applyMarkdownTransform, runInlineCommand])

  const ToolbarButton = ({
    icon,
    label,
    onPress,
  }: {
    icon?: React.ComponentProps<typeof Feather>['name']
    label?: string
    onPress: () => void
  }) => (
    <TouchableOpacity onPress={onPress} style={styles.floatingToolbarButton}>
      {icon ? <Feather name={icon} size={18} color={theme.text} /> : null}
      {label ? <Text style={[styles.toolbarButtonLabel, { color: theme.text }]}>{label}</Text> : null}
    </TouchableOpacity>
  )

  const toolbarGradientColors = isDark
    ? (['rgba(40,40,40,0.8)', 'rgba(30,30,30,0.9)'] as const)
    : (['rgba(255,255,255,0.7)', 'rgba(245,245,245,0.85)'] as const)

  const FloatingToolbar = () => (
    <View style={[styles.floatingToolbarWrapper, { bottom: toolbarBottomInset }]}>
      <BlurView intensity={80} tint={isDark ? 'dark' : 'light'} style={styles.floatingBlur}>
        <LinearGradient colors={toolbarGradientColors} style={styles.floatingGradient}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.floatingToolbarRow}
          >
            <ToolbarButton icon="bold" onPress={() => runInlineCommand(() => editorRef.current?.toggleBold())} />
            <ToolbarButton icon="italic" onPress={() => runInlineCommand(() => editorRef.current?.toggleItalic())} />
            <ToolbarButton icon="underline" onPress={() => runInlineCommand(() => editorRef.current?.toggleUnderline())} />
            <ToolbarButton label="S" onPress={() => runInlineCommand(() => editorRef.current?.toggleStrikethrough())} />
            <ToolbarButton icon="eye-off" onPress={() => runInlineCommand(() => editorRef.current?.toggleSpoiler())} />
            <ToolbarButton icon="link" onPress={handleInsertLink} />
            <ToolbarButton icon="link-2" onPress={() => runInlineCommand(() => editorRef.current?.removeLink())} />

            <View style={[styles.toolbarDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)' }]} />

            <ToolbarButton label="H1" onPress={() => { void applyMarkdownTransform(heading(1)) }} />
            <ToolbarButton label="H2" onPress={() => { void applyMarkdownTransform(heading(2)) }} />
            <ToolbarButton label="H3" onPress={() => { void applyMarkdownTransform(heading(3)) }} />
            <ToolbarButton icon="list" onPress={() => { void applyMarkdownTransform(prefixSelectedLines('- ')) }} />
            <ToolbarButton label="1." onPress={() => { void applyMarkdownTransform(numberedSelectedLines()) }} />
            <ToolbarButton icon="check-square" onPress={() => { void applyMarkdownTransform(prefixSelectedLines('- [ ] ')) }} />
            <ToolbarButton icon="message-square" onPress={() => { void applyMarkdownTransform(prefixSelectedLines('> ')) }} />
            <ToolbarButton icon="code" onPress={() => { void applyMarkdownTransform(wrapSelection('`')) }} />
            <ToolbarButton label="```" onPress={insertCodeBlock} />
          </ScrollView>
        </LinearGradient>
      </BlurView>

      <BlurView intensity={80} tint={isDark ? 'dark' : 'light'} style={styles.dismissBlur}>
        <LinearGradient colors={toolbarGradientColors} style={styles.floatingGradient}>
          <TouchableOpacity
            onPress={enterReadMode}
            style={styles.dismissButton}
          >
            <Feather name="book" size={20} color={theme.text} />
          </TouchableOpacity>
        </LinearGradient>
      </BlurView>
    </View>
  )

  const markdownStyle: MarkdownStyle = {
    paragraph: {
      color: theme.text,
      fontSize: 17,
      lineHeight: 26,
      fontFamily: 'LibreBaskerville',
      marginTop: 0,
      marginBottom: spacing.md,
    },
    h1: { color: theme.text, fontSize: 22, lineHeight: 28, fontWeight: '700', fontFamily: 'LibreBaskerville', marginBottom: spacing.md },
    h2: { color: theme.text, fontSize: 19, lineHeight: 24, fontWeight: '600', fontFamily: 'LibreBaskerville', marginBottom: spacing.sm },
    h3: { color: theme.text, fontSize: 17, lineHeight: 22, fontWeight: '600', fontFamily: 'LibreBaskerville', marginBottom: spacing.sm },
    list: {
      color: theme.text,
      fontSize: 17,
      lineHeight: 26,
      fontFamily: 'LibreBaskerville',
      bulletColor: theme.textSecondary,
      markerColor: theme.textSecondary,
      marginLeft: spacing.sm,
      gapWidth: spacing.md,
    },
    blockquote: {
      color: theme.textSecondary,
      borderColor: theme.border,
      borderWidth: 2,
      gapWidth: spacing.sm,
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      marginBottom: spacing.md,
      fontFamily: 'LibreBaskerville',
    },
    code: {
      color: theme.text,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      fontSize: 13,
      fontFamily: 'monospace',
    },
    codeBlock: {
      color: theme.text,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      padding: spacing.md,
      marginBottom: spacing.md,
      fontSize: 13,
      fontFamily: 'monospace',
    },
    link: { color: theme.accent, underline: true },
    strong: { color: theme.text, fontWeight: 'bold' },
    em: { color: theme.text, fontStyle: 'italic' },
    table: {
      color: theme.text,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      headerBackgroundColor: theme.surfaceMuted,
      headerTextColor: theme.text,
      rowEvenBackgroundColor: theme.surfaceSubtle,
      rowOddBackgroundColor: theme.surfaceMuted,
      cellPaddingHorizontal: spacing.sm,
      cellPaddingVertical: spacing.xs,
    },
    taskList: {
      checkedColor: theme.accent,
      borderColor: theme.border,
      checkmarkColor: theme.background,
      checkedTextColor: theme.textSecondary,
      checkedStrikethrough: true,
    },
  }

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
      <View style={styles.container}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          blurHeight={insets.top + 56}
          leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={handleOpenDrawer} />}
          centerSlot={
            <TextInput
              value={title}
              onChangeText={handleTitleChange}
              placeholder="Untitled"
              placeholderTextColor={theme.textDisabled}
              style={[styles.headerTitleInput, { color: theme.text }]}
              maxLength={100}
              numberOfLines={1}
            />
          }
          rightSlot={<TopBarIconButton theme={theme} icon="plus" onPress={() => onCreateNew?.()} />}
        />

        <View style={styles.editorContainer}>
          {isEditing ? (
            <EnrichedMarkdownTextInput
              key={noteId}
              ref={editorRef}
              defaultValue={markdownContent}
              onChangeMarkdown={scheduleContentSave}
              onChangeSelection={setSelection}
              onFocus={() => setIsEditing(true)}
              placeholder="Start writing…"
              placeholderTextColor={theme.textDisabled}
              multiline
              scrollEnabled
              autoFocus={markdownContent.trim().length === 0}
              cursorColor={theme.accent}
              selectionColor={theme.accent}
              style={StyleSheet.flatten([
                styles.editor,
                { color: theme.text, paddingTop: insets.top + HEADER_HEIGHT },
              ])}
              markdownStyle={{
                strong: { color: theme.text },
                em: { color: theme.text },
                link: { color: theme.accent, underline: true },
                spoiler: { color: theme.text, backgroundColor: theme.surface },
              }}
            />
          ) : (
            <ScrollView
              style={styles.previewScroll}
              contentContainerStyle={[styles.previewContent, { paddingTop: insets.top + HEADER_HEIGHT }]}
              keyboardShouldPersistTaps="handled"
            >
              <TouchableOpacity activeOpacity={1} onPress={focusEditor} style={styles.previewTapTarget}>
                {markdownContent.trim() ? (
                  <EnrichedMarkdownText
                    markdown={markdownContent}
                    flavor="github"
                    markdownStyle={markdownStyle}
                    containerStyle={styles.previewMarkdown}
                  />
                ) : (
                  <Text style={[styles.placeholderText, { color: theme.textDisabled }]}>Start writing…</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>

        {isEditing ? <FloatingToolbar /> : null}

        {!isEditing && (
          <View style={[styles.fabWrapper, { bottom: Math.max(insets.bottom, 16) + 16 }]}>
            <BlurView intensity={60} tint={isDark ? 'dark' : 'light'} style={styles.fabBlur}>
              <LinearGradient colors={toolbarGradientColors} style={styles.fabGradient}>
                <TouchableOpacity onPress={focusEditor} style={styles.fabButton}>
                  <Feather name="edit-2" size={22} color={theme.text} />
                </TouchableOpacity>
              </LinearGradient>
            </BlurView>
          </View>
        )}
        <FloatingSearchBar
          theme={theme}
          isDark={isDark}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search this note"
        />
      </View>
    </SafeAreaView>
  )
}

NoteEditor.EmptyState = function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.emptyContainer, { backgroundColor: theme.background }]}>
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        blurHeight={insets.top + 56}
        leftSlot={<View style={{ width: 44 }} />}
        centerSlot={<Text style={[styles.emptyTitle, { color: theme.text }]}>Notes</Text>}
        rightSlot={<TopBarIconButton theme={theme} icon="plus" onPress={onCreate} />}
      />
      <View style={[styles.emptyContent, { paddingTop: insets.top + 72 }]}>
        <Feather name="book-open" size={48} color={theme.mutedLight} />
        <Text style={[styles.emptyText, { color: theme.mutedLight }]}>No notes yet</Text>
        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: theme.accent }]}
          onPress={onCreate}
        >
          <Text style={[styles.createButtonText, { color: theme.background }]}>Create a note</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  },
  headerTitleInput: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'LibreBaskerville',
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  editorContainer: {
    flex: 1,
  },
  editor: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 56,
    fontSize: fontSize.md,
    lineHeight: fontSize.md * 1.6,
  },
  previewScroll: {
    flex: 1,
  },
  previewContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 56,
  },
  previewTapTarget: {
    minHeight: '100%',
  },
  previewMarkdown: {
    width: '100%',
  },
  placeholderText: {
    fontSize: fontSize.md,
    lineHeight: fontSize.md * 1.6,
  },
  // Liquid-glass FAB
  fabWrapper: {
    position: 'absolute',
    right: 16,
    zIndex: 50,
  },
  fabBlur: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  fabGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabButton: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Floating glass toolbar
  floatingToolbarWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    zIndex: 100,
  },
  floatingBlur: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  dismissBlur: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  dismissButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  floatingToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    gap: 2,
  },
  floatingToolbarButton: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  toolbarButtonLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  toolbarDivider: {
    width: 1,
    height: 24,
    marginHorizontal: 4,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  emptyContent: {
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
})
