import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { Feather } from '@expo/vector-icons'
import { Message } from '../../services/chatTypes'
import type { Theme } from '../../constants/theme'
import { spacing, fontSize } from '../../constants/theme'

interface MessageBubbleProps {
  message: Message
  theme: Theme
  onCopy?: (content: string) => void
  onDelete?: (messageId: string) => void
}

export function MessageBubble({
  message,
  theme,
  onCopy,
  onDelete
}: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user'
  const displayContent = isUser
    ? message.content
    : (message.responses?.find((r) => r.modelId === message.selectedModelId)?.content ||
       message.responses?.[0]?.content ||
       message.content)
  const isLoading = message.responses?.some((r) => r.isLoading) ?? false

  const markdownStyles = {
    body: {
      color: isUser ? '#FFFFFF' : theme.text,
      fontSize: 15,
      lineHeight: 22
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8
    },
    code_inline: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.15)' : theme.surface,
      color: isUser ? '#FFFFFF' : theme.text,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
      fontSize: 13
    },
    fence: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : theme.surface,
      borderColor: isUser ? 'rgba(255,255,255,0.2)' : theme.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      marginVertical: 8
    },
    code_block: {
      color: isUser ? '#FFFFFF' : theme.text,
      fontSize: 13
    },
    link: {
      color: isUser ? '#93C5FD' : '#3B82F6'
    },
    heading1: {
      color: isUser ? '#FFFFFF' : theme.text,
      fontSize: 20,
      fontWeight: '700' as const,
      marginTop: 16,
      marginBottom: 8
    },
    heading2: {
      color: isUser ? '#FFFFFF' : theme.text,
      fontSize: 18,
      fontWeight: '600' as const,
      marginTop: 12,
      marginBottom: 6
    },
    heading3: {
      color: isUser ? '#FFFFFF' : theme.text,
      fontSize: 16,
      fontWeight: '600' as const,
      marginTop: 10,
      marginBottom: 4
    },
    bullet_list: {
      marginVertical: 4
    },
    ordered_list: {
      marginVertical: 4
    },
    list_item: {
      marginVertical: 2
    },
    blockquote: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : theme.surface,
      borderLeftColor: isUser ? 'rgba(255,255,255,0.4)' : theme.border,
      borderLeftWidth: 3,
      paddingLeft: 12,
      paddingVertical: 4,
      marginVertical: 8
    },
    strong: {
      fontWeight: '700' as const
    },
    em: {
      fontStyle: 'italic' as const
    }
  }

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      {!isUser && (
        <View style={styles.avatarRow}>
          <View style={[styles.avatar, { backgroundColor: theme.surface }]}>
            <Feather name="cpu" size={12} color={theme.textSecondary} />
          </View>
        </View>
      )}

      <View
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: theme.buttonBg }]
            : [styles.assistantBubble, { backgroundColor: 'transparent' }]
        ]}
      >
        {isLoading && !displayContent ? (
          <View style={styles.loadingRow}>
            <Feather name="loader" size={14} color={theme.textSecondary} />
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Thinking...</Text>
          </View>
        ) : (
          <Markdown style={markdownStyles}>{displayContent}</Markdown>
        )}
      </View>

      {!isUser && displayContent && !isLoading && (
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => onCopy?.(displayContent)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="copy" size={13} color={theme.textDisabled} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDelete?.(message.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="trash-2" size={13} color={theme.textDisabled} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: spacing.lg
  },
  userContainer: {
    alignItems: 'flex-end'
  },
  assistantContainer: {
    alignItems: 'flex-start'
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  userBubble: {
    borderBottomRightRadius: 4
  },
  assistantBubble: {
    borderBottomLeftRadius: 4,
    paddingHorizontal: 0
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  loadingText: {
    fontSize: fontSize.sm
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    paddingLeft: 4
  }
})
