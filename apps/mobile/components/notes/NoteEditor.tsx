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
import {
  RichText,
  useEditorBridge,
  useEditorContent,
} from '@10play/tentap-editor'
import { fontSize, spacing, borderRadius } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { loadNote, saveNote } from '../../services/noteStorage'
import type { Note } from '../../services/types'
import { MainScreenHeader, TopBarIconButton } from '../ui/AppChrome'

const SAVE_DEBOUNCE_MS = 1200
const markdownLineBreak = /\r\n?/g
const htmlTagPattern = /<\/?[a-z][\s\S]*>/i

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseInlineMarkdown(value: string): string {
  let html = escapeHtml(value)

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  html = html.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')

  return html
}

function renderParagraph(lines: string[]): string {
  const content = lines.map((line) => parseInlineMarkdown(line)).join('<br />')
  return content ? `<p>${content}</p>` : ''
}

function parseTableRow(line: string): string[] | null {
  const match = line.match(/^\|(.+)\|$/)
  if (!match) return null
  return match[1].split('|').map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  return /^\|(?:\s*:?-+:?\s*\|)+$/.test(line.trim())
}

function parseTableAlignments(line: string): ('left' | 'center' | 'right' | null)[] {
  const cells = parseTableRow(line)
  if (!cells) return []
  return cells.map((cell) => {
    const trimmed = cell.trim()
    const left = trimmed.startsWith(':')
    const right = trimmed.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function renderTableRow(
  cells: string[],
  tag: 'td' | 'th',
  alignments?: ('left' | 'center' | 'right' | null)[],
): string {
  const cellsHtml = cells
    .map((cell, i) => {
      const align = alignments?.[i]
      const style = align ? ` style="text-align: ${align};"` : ''
      return `<${tag}${style}>${parseInlineMarkdown(cell)}</${tag}>`
    })
    .join('')
  return `<tr>${cellsHtml}</tr>`
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(markdownLineBreak, '\n').split('\n')
  const blocks: string[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let codeLines: string[] = []
  let inCodeBlock = false
  let tableRows: string[][] = []
  let tableAlignments: ('left' | 'center' | 'right' | null)[] = []
  let inTable = false
  let tableHasHeader = false

  const flushParagraph = (): void => {
    if (paragraphLines.length > 0) {
      const paragraph = renderParagraph(paragraphLines)
      if (paragraph) blocks.push(paragraph)
      paragraphLines = []
    }
  }

  const flushList = (): void => {
    if (listType && listItems.length > 0) {
      blocks.push(`<${listType}>${listItems.join('')}</${listType}>`)
    }
    listItems = []
    listType = null
  }

  const flushCodeBlock = (): void => {
    if (inCodeBlock) {
      blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      codeLines = []
      inCodeBlock = false
    }
  }

  const flushTable = (): void => {
    if (tableRows.length === 0) return

    let thead = ''
    let tbodyRows = tableRows

    if (tableHasHeader && tableRows.length > 0) {
      thead = `<thead>${renderTableRow(tableRows[0], 'th', tableAlignments)}</thead>`
      tbodyRows = tableRows.slice(1)
    }

    const tbody =
      tbodyRows.length > 0
        ? `<tbody>${tbodyRows.map((row) => renderTableRow(row, 'td', tableAlignments)).join('')}</tbody>`
        : ''

    blocks.push(`<table>${thead}${tbody}</table>`)
    tableRows = []
    tableAlignments = []
    inTable = false
    tableHasHeader = false
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const tableRowCells = parseTableRow(line)

    if (tableRowCells) {
      if (!inTable) {
        flushParagraph()
        flushList()
        inTable = true
        tableRows = [tableRowCells]
      } else if (isTableSeparator(line)) {
        tableHasHeader = true
        tableAlignments = parseTableAlignments(line)
      } else {
        tableRows.push(tableRowCells)
      }
      continue
    }

    if (inTable) flushTable()

    if (line.startsWith('```')) {
      flushParagraph()
      flushList()
      if (inCodeBlock) {
        flushCodeBlock()
      } else {
        inCodeBlock = true
        codeLines = []
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(rawLine)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${parseInlineMarkdown(headingMatch[2])}</h${level}>`)
      continue
    }

    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      flushParagraph()
      flushList()
      blocks.push('<hr />')
      continue
    }

    const blockquoteMatch = line.match(/^>\s+(.+)$/)
    if (blockquoteMatch) {
      flushParagraph()
      flushList()
      blocks.push(`<blockquote><p>${parseInlineMarkdown(blockquoteMatch[1])}</p></blockquote>`)
      continue
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    if (unorderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ul') flushList()
      listType = 'ul'
      listItems.push(`<li><p>${parseInlineMarkdown(unorderedMatch[1])}</p></li>`)
      continue
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      if (listType && listType !== 'ol') flushList()
      listType = 'ol'
      listItems.push(`<li><p>${parseInlineMarkdown(orderedMatch[1])}</p></li>`)
      continue
    }

    flushList()
    paragraphLines.push(line)
  }

  if (inTable) flushTable()
  flushParagraph()
  flushList()
  flushCodeBlock()

  return blocks.join('')
}

function normalizeNoteContent(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return '<p></p>'
  if (htmlTagPattern.test(trimmed)) return markdownTextNodesToHtml(content)
  return markdownToHtml(content)
}

function markdownTextNodesToHtml(html: string): string {
  const tokens = html.split(/(<[^>]+>)/g)
  const stack: string[] = []

  return tokens
    .map((token) => {
      if (!token) return ''
      if (token.startsWith('<')) {
        const close = token.match(/^<\/\s*([a-z0-9-]+)/i)
        const open = token.match(/^<\s*([a-z0-9-]+)(?:\s|>|\/)/i)

        if (close) {
          const tag = close[1].toLowerCase()
          const index = stack.lastIndexOf(tag)
          if (index >= 0) stack.splice(index, 1)
        } else if (open && !token.endsWith('/>')) {
          const tag = open[1].toLowerCase()
          if (tag === 'pre' || tag === 'code') stack.push(tag)
        }
        return token
      }

      if (stack.length > 0 || !hasMarkdownSyntax(token)) return token
      return parseInlineMarkdown(token)
    })
    .join('')
}

function hasMarkdownSyntax(value: string): boolean {
  return /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|(^|[\s(])[*_][^*_\n]+[*_](?=$|[\s).,!?:;]))/.test(value)
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
  const { openDrawer } = useDrawer()
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isReady, setIsReady] = useState(false)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<string>('')

  // Load note first
  const load = useCallback(async () => {
    setIsLoading(true)
    setIsReady(false)
    try {
      const loaded = await loadNote(noteId)
      if (loaded) {
        setNote(loaded)
        setTitle(loaded.title)
        const htmlContent = normalizeNoteContent(loaded.content || '')
        contentRef.current = htmlContent
        // Mark ready after content is loaded - editor will be rendered then
        setIsReady(true)
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

  // Only initialize editor after content is ready
  const editor = useEditorBridge({
    autofocus: false,
    avoidIosKeyboard: true,
    initialContent: isReady ? contentRef.current : '',
    theme: {
      webview: {
        backgroundColor: theme.background,
      },
    },
  })

  useEffect(() => {
    if (!isReady) return
    editor.setContent(contentRef.current)
  }, [editor, isReady, noteId])

  // Get content from editor
  const content = useEditorContent(editor, { type: 'html' })

  const performSave = useCallback(async (currentTitle: string, currentHtmlContent: string) => {
    if (!note) return
    try {
      await saveNote({
        ...note,
        title: currentTitle,
        content: currentHtmlContent,
      })
    } catch {
      // ignore — will remain dirty and retry next keystroke
    }
  }, [note])

  // Save when content changes
  useEffect(() => {
    if (content && content !== contentRef.current) {
      contentRef.current = content

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = setTimeout(() => {
        void performSave(title, content)
      }, SAVE_DEBOUNCE_MS)
    }
  }, [content, title, performSave])

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = setTimeout(() => {
        void performSave(text, contentRef.current)
      }, SAVE_DEBOUNCE_MS)
      onTitleChange?.(text)
    },
    [onTitleChange, performSave],
  )

  // Note: delete action available via sidebar long-press context menu

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

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

  // Rich text formatting actions using tentap editor bridge
  const formattingActions = {
    bold: () => editor.toggleBold?.(),
    italic: () => editor.toggleItalic?.(),
    underline: () => editor.toggleUnderline?.(),
    strike: () => editor.toggleStrike?.(),
    code: () => editor.toggleCode?.(),
    quote: () => editor.toggleBlockquote?.(),
    heading1: () => editor.toggleHeading?.(1),
    heading2: () => editor.toggleHeading?.(2),
    heading3: () => editor.toggleHeading?.(3),
    bulletList: () => editor.toggleBulletList?.(),
    numberedList: () => editor.toggleOrderedList?.(),
    checkList: () => editor.toggleTaskList?.(),
    lift: () => editor.lift?.(),
    sink: () => editor.sink?.(),
    undo: () => editor.undo?.(),
    redo: () => editor.redo?.(),
  }

  const handleOpenDrawer = useCallback(() => {
    ;(editor as { blur?: () => void }).blur?.()
    Keyboard.dismiss()
    openDrawer()
  }, [editor, openDrawer])

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  const toolbarBottomInset = keyboardHeight > 0 ? keyboardHeight + 4 : Math.max(insets.bottom, 4) + 6

  const toolbarItems: Array<{
    key: string
    icon?: keyof typeof Feather.glyphMap
    label?: string
    onPress: () => void
  }> = [
    { key: 'undo', icon: 'corner-up-left', onPress: formattingActions.undo },
    { key: 'redo', icon: 'corner-up-right', onPress: formattingActions.redo },
    { key: 'task', icon: 'check-square', onPress: formattingActions.checkList },
    { key: 'h1', label: 'H1', onPress: formattingActions.heading1 },
    { key: 'h2', label: 'H2', onPress: formattingActions.heading2 },
    { key: 'h3', label: 'H3', onPress: formattingActions.heading3 },
    { key: 'bold', icon: 'bold', onPress: formattingActions.bold },
    { key: 'italic', icon: 'italic', onPress: formattingActions.italic },
    { key: 'underline', icon: 'underline', onPress: formattingActions.underline },
    { key: 'strike', icon: 'minus', onPress: formattingActions.strike },
    { key: 'bullet', icon: 'list', onPress: formattingActions.bulletList },
    { key: 'ordered', icon: 'hash', onPress: formattingActions.numberedList },
    { key: 'quote', icon: 'chevron-right', onPress: formattingActions.quote },
    { key: 'code', icon: 'code', onPress: formattingActions.code },
    { key: 'outdent', icon: 'arrow-left', onPress: formattingActions.lift },
    { key: 'indent', icon: 'arrow-right', onPress: formattingActions.sink },
  ]

  // Floating glass toolbar
  const FloatingToolbar = () => (
    <View style={[styles.floatingToolbarWrapper, { bottom: toolbarBottomInset }]}>
      <BlurView
        intensity={80}
        tint={isDark ? 'dark' : 'light'}
        style={styles.floatingBlur}
      >
        <LinearGradient
          colors={isDark 
            ? ['rgba(40,40,40,0.8)', 'rgba(30,30,30,0.9)'] 
            : ['rgba(255,255,255,0.7)', 'rgba(245,245,245,0.85)']}
          style={styles.floatingGradient}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.floatingToolbarRow}
          >
            {toolbarItems.map((item, index) => (
              <React.Fragment key={item.key}>
                {index === 2 || index === 6 || index === 10 || index === 14 ? (
                  <View style={[styles.toolbarDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)' }]} />
                ) : null}
                <TouchableOpacity onPress={item.onPress} style={styles.floatingToolbarButton}>
                  {item.icon ? (
                    <Feather name={item.icon} size={19} color={theme.text} />
                  ) : (
                    <Text style={[styles.headingText, { color: theme.text }]}>{item.label}</Text>
                  )}
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </ScrollView>
        </LinearGradient>
      </BlurView>
    </View>
  )

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
          <RichText
            editor={editor}
            style={[styles.richText, { backgroundColor: theme.background }]}
          />
        </View>

        {/* Floating glass toolbar */}
        <FloatingToolbar />
      </View>
    </SafeAreaView>
  )
}

// No HTML stripping needed for rich text editor

// EmptyState component
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
    fontSize: fontSize.md,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  editorContainer: {
    flex: 1,
    marginTop: 60,
    paddingHorizontal: spacing.xs,
  },
  richText: {
    flex: 1,
  },
  // Floating glass toolbar styles
  floatingToolbarWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  floatingBlur: {
    width: '94%',
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  floatingGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  floatingToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 2,
  },
  floatingToolbarButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  toolbarDivider: {
    width: 1,
    height: 28,
    marginHorizontal: 6,
  },
  headingText: {
    fontSize: 18,
    fontWeight: '700',
  },
  // Empty state styles
  emptyContainer: {
    flex: 1,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
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
