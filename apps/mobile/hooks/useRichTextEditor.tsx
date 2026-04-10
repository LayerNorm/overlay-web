import React, { useRef, useCallback } from 'react'
import { View, StyleSheet } from 'react-native'
import {
  RichText,
  Toolbar,
  useEditorBridge,
  useEditorContent,
  DEFAULT_TOOLBAR_ITEMS
} from '@10play/tentap-editor'
import type { Theme } from '../constants/theme'

interface UseRichTextEditorReturn {
  editorComponent: React.ReactElement
  getContent: () => string
  setContent: (html: string) => void
}

interface UseRichTextEditorOptions {
  initialContent?: string
  placeholder?: string
  onContentChange?: (html: string) => void
}

export function useRichTextEditor(
  theme: Theme,
  options: UseRichTextEditorOptions = {}
): UseRichTextEditorReturn {
  const contentRef = useRef<string>('')
  const initialContent = options.initialContent || ''
  const onContentChange = options.onContentChange

  const editor = useEditorBridge({
    autofocus: false,
    avoidIosKeyboard: true,
    initialContent,
    theme: {
      toolbar: {
        toolbarBody: {
          borderTopColor: theme.border,
          backgroundColor: theme.surface
        },
        toolbarButton: {
          backgroundColor: 'transparent'
        }
      },
      webview: {
        backgroundColor: theme.background
      }
    }
  })

  const content = useEditorContent(editor, { type: 'html' })

  React.useEffect(() => {
    if (content) {
      contentRef.current = content
      onContentChange?.(content)
    }
  }, [content, onContentChange])

  React.useEffect(() => {
    if (initialContent !== undefined) {
      contentRef.current = initialContent
      editor.setContent(initialContent)
    }
  }, [editor, initialContent])

  const getContent = useCallback((): string => {
    return contentRef.current
  }, [])

  const setContent = useCallback((html: string) => {
    contentRef.current = html
    editor.setContent(html)
  }, [editor])

  const editorComponent = (
    <View style={styles.container}>
      <RichText
        editor={editor}
        style={[styles.richText, { backgroundColor: theme.background }]}
      />
      <Toolbar
        editor={editor}
        items={DEFAULT_TOOLBAR_ITEMS}
      />
    </View>
  )

  return { editorComponent, getContent, setContent }
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  richText: {
    flex: 1
  }
})
