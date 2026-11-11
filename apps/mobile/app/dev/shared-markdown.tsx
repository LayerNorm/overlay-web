import React, { useMemo, useRef, useState } from 'react'
import { Redirect, Stack, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SharedMarkdownConversation } from '../../components/chat/SharedMarkdownConversation'
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
  const { isDark } = useTheme()
  const [messages, setMessages] = useState(initialMessages)
  const [isStreaming, setIsStreaming] = useState(false)
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
    <SafeAreaView style={[styles.root, { backgroundColor: isDark ? '#09090b' : '#fafafa' }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (router.canGoBack()) router.back()
            else router.replace('/')
          }}
        >
          <Text style={[styles.control, { color: isDark ? '#f5f5f5' : '#0a0a0a' }]}>Back</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={appendStreamChunk}>
          <Text style={[styles.control, { color: isDark ? '#f5f5f5' : '#0a0a0a' }]}>Append stream chunk</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setIsStreaming(false)}>
          <Text style={[styles.control, { color: isDark ? '#f5f5f5' : '#0a0a0a' }]}>Finish stream</Text>
        </Pressable>
      </View>
      <SharedMarkdownConversation snapshot={snapshot} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12, paddingVertical: 8 },
  control: { fontSize: 13, fontWeight: '600' },
})
