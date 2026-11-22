import React from 'react'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import type { Theme } from '../../constants/theme'

/**
 * Native markdown. `variant="chat"` is the reading size for assistant replies
 * (paragraphs, lists, headings and code share one type scale); the default is
 * the compact size used in Work details.
 */
export function WorkMarkdown({
  text,
  theme,
  variant = 'compact',
}: {
  text: string
  theme: Theme
  variant?: 'compact' | 'chat'
}) {
  const chat = variant === 'chat'
  const body = {
    fontFamily: 'Geist',
    color: (chat ? theme.foreground : theme.muted) as string,
    fontSize: chat ? 16 : 14,
    lineHeight: chat ? 24 : 22,
  }
  return (
    <EnrichedMarkdownText
      markdown={text}
      markdownStyle={{
        paragraph: { ...body, marginTop: 0, marginBottom: chat ? 8 : 0 },
        list: {
          fontFamily: body.fontFamily,
          color: body.color,
          fontSize: body.fontSize,
          // The native view under-measures list bottom margins (text after a
          // list gets clipped), so lists keep zero vertical margins.
          marginTop: 0,
          marginBottom: 0,
          lineHeight: body.lineHeight,
          bulletColor: theme.foreground as string,
          bulletSize: chat ? 5 : 4,
          markerColor: theme.foreground as string,
          gapWidth: chat ? 10 : 8,
          marginLeft: chat ? 6 : 4,
        },
        strong: { fontFamily: 'GeistSemibold', fontWeight: 'normal', color: theme.foreground as string },
        h1: { fontFamily: 'GeistSemibold', color: theme.foreground as string, fontSize: chat ? 22 : 20, lineHeight: chat ? 28 : undefined, marginTop: chat ? 8 : 0, marginBottom: chat ? 8 : 0 },
        h2: { fontFamily: 'GeistSemibold', color: theme.foreground as string, fontSize: chat ? 19 : 17, lineHeight: chat ? 25 : undefined, marginTop: chat ? 8 : 0, marginBottom: chat ? 6 : 0 },
        h3: { fontFamily: 'GeistSemibold', color: theme.foreground as string, fontSize: chat ? 17 : 15, marginTop: chat ? 6 : 0, marginBottom: chat ? 4 : 0 },
        link: { color: theme.foreground as string, underline: true },
        code: {
          color: theme.foreground as string,
          backgroundColor: theme.surfaceMuted as string,
          fontFamily: 'Menlo',
        },
        codeBlock: {
          fontFamily: 'Menlo',
          fontSize: 13.5,
          lineHeight: 20,
          color: theme.foreground as string,
          backgroundColor: theme.surfaceSubtle as string,
          borderColor: theme.border as string,
          borderWidth: 0.5,
          borderRadius: 14,
          padding: 14,
          marginTop: 4,
          marginBottom: 12,
        },
        blockquote: {
          ...body,
          color: theme.muted as string,
          borderColor: theme.border as string,
          borderWidth: 3,
          gapWidth: 12,
        },
      }}
    />
  )
}
