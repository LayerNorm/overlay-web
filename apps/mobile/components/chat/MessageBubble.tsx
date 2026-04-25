import React from 'react'
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
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
  const hasReasoning = !isUser && !!message.reasoning?.trim()
  const toolInvocations = !isUser ? message.toolInvocations || [] : []
  const generatedFiles = !isUser ? message.generatedFiles || [] : []

  const markdownStyles = {
    body: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
      fontSize: 15,
      lineHeight: 23
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8
    },
    code_inline: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.14)' : theme.surfaceMuted,
      color: isUser ? theme.buttonPrimaryText : theme.text,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
      fontSize: 13
    },
    fence: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : theme.surfaceMuted,
      borderColor: isUser ? 'rgba(255,255,255,0.2)' : theme.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      marginVertical: 8
    },
    code_block: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
      fontSize: 13
    },
    link: {
      color: isUser ? '#93C5FD' : '#3B82F6'
    },
    heading1: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
      fontSize: 20,
      fontWeight: '700' as const,
      marginTop: 16,
      marginBottom: 8
    },
    heading2: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
      fontSize: 18,
      fontWeight: '600' as const,
      marginTop: 12,
      marginBottom: 6
    },
    heading3: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
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
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : theme.surfaceMuted,
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
      <View
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: theme.buttonPrimaryBg }]
            : styles.assistantBubble
        ]}
      >
        {message.imageData ? (
          <View style={[styles.attachmentTag, { backgroundColor: isUser ? 'rgba(255,255,255,0.12)' : theme.surfaceMuted }]}>
            <Feather
              name="image"
              size={13}
              color={isUser ? '#FFFFFF' : theme.textSecondary}
            />
            <Text
              style={[
                styles.attachmentTagText,
                { color: isUser ? '#FFFFFF' : theme.textSecondary }
              ]}
            >
              Image attached
            </Text>
          </View>
        ) : null}

        {isLoading && !displayContent ? (
          <View style={styles.loadingRow}>
            <View style={[styles.pulseDot, { backgroundColor: theme.textSecondary }]} />
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Thinking...</Text>
          </View>
        ) : displayContent ? (
          <Markdown style={markdownStyles}>{displayContent}</Markdown>
        ) : (
          <Text style={[styles.emptyAssistantText, { color: theme.textSecondary }]}>
            Waiting for model output…
          </Text>
        )}
      </View>

      {hasReasoning ? (
        <View style={[styles.supplementaryBlock, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Text style={[styles.supplementaryLabel, { color: theme.textSecondary }]}>Reasoning</Text>
          <Markdown style={markdownStyles}>{message.reasoning!.trim()}</Markdown>
        </View>
      ) : null}

      {toolInvocations.length > 0 ? (
        <View style={[styles.supplementaryBlock, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Text style={[styles.supplementaryLabel, { color: theme.textSecondary }]}>Tools</Text>
          {toolInvocations.map((tool, index) => (
            <View
              key={`${tool.toolCallId || tool.toolName}-${index}`}
              style={[styles.toolRow, { borderBottomColor: theme.border }]}
            >
              <View style={styles.toolHeader}>
                <Feather name="cpu" size={13} color={theme.textSecondary} />
                <Text style={[styles.toolName, { color: theme.text }]}>{tool.toolName}</Text>
              </View>
              <Text style={[styles.toolState, { color: theme.textSecondary }]}>
                {tool.state || 'completed'}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {generatedFiles.length > 0 ? (
        <View style={[styles.supplementaryBlock, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Text style={[styles.supplementaryLabel, { color: theme.textSecondary }]}>Outputs</Text>
          {generatedFiles.map((file, index) => (
            <TouchableOpacity
              key={`${file.url}-${index}`}
              onPress={() => {
                void Linking.openURL(file.url)
              }}
              activeOpacity={0.82}
              style={[styles.fileRow, { borderBottomColor: theme.border }]}
            >
              <View style={styles.toolHeader}>
                <Feather name="link" size={13} color={theme.textSecondary} />
                <Text style={[styles.fileLabel, { color: theme.text }]}>
                  {file.mediaType.startsWith('image/')
                    ? 'Generated image'
                    : file.mediaType.startsWith('video/')
                      ? 'Generated video'
                      : 'Generated file'}
                </Text>
              </View>
              <Feather name="external-link" size={14} color={theme.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {!isUser && displayContent && !isLoading && (
        <View style={styles.actions}>
          <Text style={[styles.metaLabel, { color: theme.textDisabled }]}>
            {message.responses?.[0]?.modelName || 'Overlay'}
          </Text>
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
    marginVertical: 8,
    paddingHorizontal: spacing.md,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  bubble: {
    maxWidth: '100%',
  },
  userBubble: {
    maxWidth: '86%',
    borderRadius: 18,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  assistantBubble: {
    width: '100%',
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    opacity: 0.8,
  },
  loadingText: {
    fontSize: fontSize.sm,
  },
  emptyAssistantText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  attachmentTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  attachmentTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  supplementaryBlock: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 6,
  },
  supplementaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  toolRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  toolState: {
    fontSize: 12,
    marginTop: 4,
  },
  fileRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  fileLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    paddingLeft: 2,
  },
})
