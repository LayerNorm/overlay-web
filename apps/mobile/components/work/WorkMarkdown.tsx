import React from 'react'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import type { Theme } from '../../constants/theme'

export function WorkMarkdown({ text, theme }: { text: string; theme: Theme }) {
  return (
    <EnrichedMarkdownText
      markdown={text}
      markdownStyle={{
        paragraph: {
          fontFamily: 'Geist',
          color: theme.muted,
          fontSize: 14,
          lineHeight: 22,
          marginTop: 0,
          marginBottom: 0,
        },
        h1: { fontFamily: 'GeistSemibold', color: theme.foreground, fontSize: 20 },
        h2: { fontFamily: 'GeistSemibold', color: theme.foreground, fontSize: 17 },
        link: { color: theme.foreground, underline: true },
        code: {
          color: theme.foreground,
          backgroundColor: theme.surfaceMuted,
          fontFamily: 'monospace',
        },
      }}
    />
  )
}
