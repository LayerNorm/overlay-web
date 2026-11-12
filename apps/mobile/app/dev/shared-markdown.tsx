import React, { useMemo, useRef, useState } from 'react'
import { Redirect, Stack, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SharedMarkdownConversation } from '../../components/chat/SharedMarkdownConversation'
import { SharedTranscriptProofMode } from '../../components/chat/SharedTranscriptProofMode'
import { useTheme } from '../../hooks/useTheme'
import type { SharedMarkdownMessageSnapshot } from '../../lib/sharedMarkdownBridge'

const initialMessages: SharedMarkdownMessageSnapshot[] = [
  {
    id: 'shared-markdown-proof',
    text: String.raw`Saved math:

$$
\dots \quad \tfrac{1}{2} \quad \begin{bmatrix}1&2\\3&4\end{bmatrix}
$$

[Open example.com](https://example.com)

[Unsafe script link](javascript:alert(1))

| Item | Value |
| --- | --- |
| Markdown table | Shared renderer |

~~~ts
const value = 42
console.log(value)
~~~`,
  },
]

export default function SharedMarkdownProofScreen() {
  const router = useRouter()
  const { theme, isDark } = useTheme()
  const [messages, setMessages] = useState(initialMessages)
  const [isStreaming, setIsStreaming] = useState(false)
  const [mode, setMode] = useState<'markdown' | 'transcript'>('markdown')
  const streamChunkRef = useRef(0)
  const snapshot = useMemo(() => ({
    theme: isDark ? 'dark' as const : 'light' as const,
    isStreaming,
    messages,
  }), [isDark, isStreaming, messages])

  if (!__DEV__) return <Redirect href="/" />

  const appendStreamChunk = () => {
    streamChunkRef.current += 1
    const chunk = streamChunkRef.current
    setMessages((current) => current.map((message, index) => (
      index === current.length - 1
        ? { ...message, text: `${message.text}\n\nStreaming update ${chunk}.` }
        : message
    )))
    setIsStreaming(true)
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" style={styles.toolbarButton} onPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/')
        }}>
          <Text style={[styles.control, { color: theme.text }]}>Back</Text>
        </Pressable>
        {mode === 'markdown' ? <>
          <Pressable accessibilityRole="button" style={styles.toolbarButton} onPress={appendStreamChunk}>
            <Text style={[styles.control, { color: theme.text }]}>Append stream chunk</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.toolbarButton} onPress={() => setIsStreaming(false)}>
            <Text style={[styles.control, { color: theme.text }]}>Finish stream</Text>
          </Pressable>
        </> : null}
        <Pressable accessibilityRole="button" style={styles.toolbarButton} onPress={() => setMode((current) => current === 'markdown' ? 'transcript' : 'markdown')}>
          <Text style={[styles.control, { color: theme.text }]}>
            {mode === 'markdown' ? 'Shared transcript proof' : 'Show Markdown fixture'}
          </Text>
        </Pressable>
      </View>
      {mode === 'markdown'
        ? <SharedMarkdownConversation snapshot={snapshot} />
        : <View style={styles.transcriptProof}>
            <Text style={[styles.proofLabel, { color: theme.textSecondary }]}>Shared transcript proof · synthetic data · Copy only</Text>
            <SharedTranscriptProofMode />
          </View>}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  toolbarButton: { maxWidth: '100%', paddingHorizontal: 4, paddingVertical: 4 },
  control: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  transcriptProof: { flex: 1, minHeight: 0 },
  proofLabel: { fontSize: 12, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 6 },
})
