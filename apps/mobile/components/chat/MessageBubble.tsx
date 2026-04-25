import React, { useEffect, useState } from 'react'
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Markdown from 'react-native-markdown-display'
import { Feather } from '@expo/vector-icons'
import type { Message, ToolInvocationSummary } from '../../services/chatTypes'
import type { Theme } from '../../constants/theme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'

const OVERLAY_LOGO = require('../../../overlay-logo.png')

const DONE_STATES = new Set(['output-available', 'output-error', 'output-denied'])

// ─── Tool label helpers ───────────────────────────────────────────────────────

const TOOL_LABEL_MAP: Record<string, string> = {
  browser_run_task: 'Browsing the web',
  interactive_browser_session: 'Browsing the web',
  perplexity_search: 'Searching the web',
  parallel_search: 'Deep web research',
  search_knowledge: 'Searching your knowledge',
  list_skills: 'Checking your skills',
  list_notes: 'Listing your notes',
  get_note: 'Opening a note',
  create_note: 'Creating a note',
  update_note: 'Updating a note',
  delete_note: 'Deleting a note',
  save_memory: 'Saving to memory',
  update_memory: 'Updating memory',
  delete_memory: 'Deleting memory',
  generate_image: 'Generating an image',
  generate_video: 'Generating a video',
  run_daytona_sandbox: 'Running your workspace',
}

function titleCaseUnderscore(id: string): string {
  return id
    .trim()
    .split(/_+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

function getToolLabel(toolName: string): string {
  return TOOL_LABEL_MAP[toolName] ?? titleCaseUnderscore(toolName)
}

// ─── Shimmer animation ────────────────────────────────────────────────────────

function useShimmerStyle() {
  const opacity = useSharedValue(0.5)
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700 }),
        withTiming(0.3, { duration: 700 }),
      ),
      -1,
      false,
    )
  }, [opacity])
  return useAnimatedStyle(() => ({ opacity: opacity.value }))
}

// ─── Streaming cursor (pulsing overlay logo) ──────────────────────────────────

function StreamingCursor() {
  const opacity = useSharedValue(1)
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.1, { duration: 420 }),
        withTiming(1, { duration: 420 }),
      ),
      -1,
      false,
    )
  }, [opacity])
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return (
    <Animated.View style={[styles.cursor, animStyle]}>
      <Image source={OVERLAY_LOGO} style={styles.cursorImage} resizeMode="contain" />
    </Animated.View>
  )
}

// ─── Reasoning block ──────────────────────────────────────────────────────────

function ReasoningBlock({
  text,
  isStreaming,
  theme,
}: {
  text: string
  isStreaming: boolean
  theme: Theme
}) {
  const [expanded, setExpanded] = useState(false)
  const shimmerStyle = useShimmerStyle()
  const hasText = text.trim().length > 0
  const showContent = (isStreaming && hasText) || (!isStreaming && expanded && hasText)

  return (
    <View style={styles.toolRow}>
      <View style={styles.logoCol}>
        <Image source={OVERLAY_LOGO} style={styles.toolLogo} resizeMode="contain" />
      </View>
      <View style={styles.toolContent}>
        <View style={styles.toolHeaderRow}>
          {isStreaming ? (
            <Animated.View style={shimmerStyle}>
              <Text style={[styles.toolLabel, { color: theme.textSecondary }]}>Thinking…</Text>
            </Animated.View>
          ) : (
            <Text style={[styles.toolLabel, { color: theme.textSecondary }]}>Thought</Text>
          )}
          {!isStreaming && hasText ? (
            <TouchableOpacity
              onPress={() => setExpanded((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={13}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
          ) : null}
        </View>
        {showContent ? (
          <ScrollView
            style={[styles.reasoningScroll, { borderColor: theme.border }]}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.reasoningText, { color: theme.textSecondary }]}>
              {text.trim()}
            </Text>
          </ScrollView>
        ) : null}
      </View>
    </View>
  )
}

// ─── Tool call row ────────────────────────────────────────────────────────────

function ToolCallRow({ tool, theme }: { tool: ToolInvocationSummary; theme: Theme }) {
  const isDone = DONE_STATES.has(tool.state ?? '')
  const isError = tool.state === 'output-error' || tool.state === 'output-denied'
  const shimmerStyle = useShimmerStyle()
  const label = getToolLabel(tool.toolName)

  return (
    <View style={styles.toolRow}>
      <View style={styles.logoCol}>
        <Image source={OVERLAY_LOGO} style={styles.toolLogo} resizeMode="contain" />
      </View>
      <View style={styles.toolContent}>
        {isDone || isError ? (
          <Text
            style={[styles.toolLabel, { color: isError ? '#EF4444' : theme.textSecondary }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        ) : (
          <Animated.View style={shimmerStyle}>
            <Text style={[styles.toolLabel, { color: theme.textSecondary }]} numberOfLines={1}>
              {label}
            </Text>
          </Animated.View>
        )}
      </View>
    </View>
  )
}

// ─── Streaming text display ───────────────────────────────────────────────────
// Complete lines rendered as Markdown; the partial trailing line as plain text + cursor.

function StreamingMarkdown({
  text,
  theme,
  markdownStyles,
}: {
  text: string
  theme: Theme
  markdownStyles: Record<string, unknown>
}) {
  // Find the last newline that isn't at the very end so we can split stable vs current line
  const lastNl = text.lastIndexOf('\n', text.length - 2)
  const stableText = lastNl >= 0 ? text.slice(0, lastNl + 1) : ''
  const currentLine = lastNl >= 0 ? text.slice(lastNl + 1) : text

  // Animate the current-line view in each time it changes
  const [lineKey, setLineKey] = useState(0)
  const prevCurrentLine = React.useRef('')
  useEffect(() => {
    if (currentLine !== prevCurrentLine.current) {
      prevCurrentLine.current = currentLine
      setLineKey((k) => k + 1)
    }
  }, [currentLine])

  return (
    <View>
      {stableText ? <Markdown style={markdownStyles}>{stableText}</Markdown> : null}
      <View style={styles.streamingLine}>
        <Animated.View key={lineKey} entering={FadeIn.duration(80)} style={styles.streamingLineText}>
          <Text style={[{ color: theme.text, fontSize: 15, lineHeight: 23 }]}>
            {currentLine}
          </Text>
        </Animated.View>
        <StreamingCursor />
      </View>
    </View>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: Message
  theme: Theme
  onCopy?: (content: string) => void
  onDelete?: (messageId: string) => void
}

export const MessageBubble = React.memo(function MessageBubble({
  message,
  theme,
  onCopy,
}: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user'
  const displayContent = isUser
    ? message.content
    : (message.responses?.find((r) => r.modelId === message.selectedModelId)?.content ||
       message.responses?.[0]?.content ||
       message.content)
  const isLoading = (message.responses?.some((r) => r.isLoading) ?? false)
  const hasReasoning = !isUser && !!message.reasoning?.trim()
  const toolInvocations: ToolInvocationSummary[] = !isUser ? (message.toolInvocations || []) : []
  const generatedFiles = !isUser ? (message.generatedFiles || []) : []

  const markdownStyles = {
    body: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
      fontSize: 15,
      lineHeight: 23,
    },
    paragraph: { marginTop: 0, marginBottom: 8 },
    code_inline: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.14)' : theme.surfaceMuted,
      color: isUser ? theme.buttonPrimaryText : theme.text,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
      fontSize: 13,
    },
    fence: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : theme.surfaceMuted,
      borderColor: isUser ? 'rgba(255,255,255,0.2)' : theme.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      marginVertical: 8,
    },
    code_block: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
      fontSize: 13,
    },
    link: { color: isUser ? '#93C5FD' : '#3B82F6' },
    heading1: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
      fontSize: 20,
      fontWeight: '700' as const,
      marginTop: 16,
      marginBottom: 8,
    },
    heading2: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
      fontSize: 18,
      fontWeight: '600' as const,
      marginTop: 12,
      marginBottom: 6,
    },
    heading3: {
      color: isUser ? theme.buttonPrimaryText : theme.text,
      fontSize: 16,
      fontWeight: '600' as const,
      marginTop: 10,
      marginBottom: 4,
    },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { marginVertical: 2 },
    blockquote: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : theme.surfaceMuted,
      borderLeftColor: isUser ? 'rgba(255,255,255,0.4)' : theme.border,
      borderLeftWidth: 3,
      paddingLeft: 12,
      paddingVertical: 4,
      marginVertical: 8,
    },
    strong: { fontWeight: '700' as const },
    em: { fontStyle: 'italic' as const },
  }

  // ── User bubble ──────────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <Animated.View entering={FadeIn.duration(150)} style={[styles.container, styles.userContainer]}>
        <View style={[styles.userBubble, { backgroundColor: theme.buttonPrimaryBg }]}>
          {message.imageData ? (
            <View style={[styles.attachmentTag, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
              <Feather name="image" size={13} color="#FFFFFF" />
              <Text style={[styles.attachmentTagText, { color: '#FFFFFF' }]}>Image attached</Text>
            </View>
          ) : null}
          <Text style={[styles.userText, { color: theme.buttonPrimaryText }]}>
            {message.content}
          </Text>
        </View>
      </Animated.View>
    )
  }

  // ── Assistant bubble ─────────────────────────────────────────────────────────
  const showInitialCursor = isLoading && !displayContent && !hasReasoning && toolInvocations.length === 0

  return (
    <View style={[styles.container, styles.assistantContainer]}>
      {/* Reasoning block */}
      {hasReasoning ? (
        <ReasoningBlock
          text={message.reasoning!}
          isStreaming={isLoading && !displayContent}
          theme={theme}
        />
      ) : null}

      {/* Tool call rows */}
      {toolInvocations.map((tool, idx) => (
        <ToolCallRow
          key={tool.toolCallId || `${tool.toolName}-${idx}`}
          tool={tool}
          theme={theme}
        />
      ))}

      {/* Text content */}
      {showInitialCursor ? (
        <View style={styles.initialCursor}>
          <StreamingCursor />
        </View>
      ) : displayContent ? (
        isLoading ? (
          <StreamingMarkdown text={displayContent} theme={theme} markdownStyles={markdownStyles} />
        ) : (
          <Markdown style={markdownStyles}>{displayContent}</Markdown>
        )
      ) : null}

      {/* Generated files */}
      {generatedFiles.length > 0 ? (
        <View style={[styles.filesBlock, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          {generatedFiles.map((file, index) => (
            <TouchableOpacity
              key={`${file.url}-${index}`}
              onPress={() => { void Linking.openURL(file.url) }}
              activeOpacity={0.82}
              style={[styles.fileRow, { borderBottomColor: theme.border }]}
            >
              <View style={styles.fileRowLeft}>
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

      {/* Footer */}
      {!isLoading && displayContent ? (
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
        </View>
      ) : null}
    </View>
  )
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
    paddingHorizontal: spacing.md,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
  },

  // User bubble
  userBubble: {
    maxWidth: '86%',
    borderRadius: 18,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    fontSize: 15,
    lineHeight: 23,
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

  // Tool call rows
  toolRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 3,
    minHeight: 24,
  },
  logoCol: {
    width: 16,
    alignItems: 'center',
    paddingTop: 2,
  },
  toolLogo: {
    width: 14,
    height: 14,
  },
  toolContent: {
    flex: 1,
    gap: 4,
  },
  toolHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolLabel: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Reasoning scroll
  reasoningScroll: {
    maxHeight: 180,
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginTop: 4,
  },
  reasoningText: {
    fontSize: 12,
    lineHeight: 18,
  },

  // Streaming text
  streamingLine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    flexWrap: 'wrap',
  },
  streamingLineText: {
    flexShrink: 1,
  },

  // Streaming cursor (overlay logo)
  cursor: {
    width: 14,
    height: 14,
    marginBottom: 3,
  },
  cursorImage: {
    width: 14,
    height: 14,
  },

  // Initial loading state (just the cursor)
  initialCursor: {
    paddingVertical: 8,
    paddingLeft: 2,
  },

  // Files block
  filesBlock: {
    width: '100%',
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginTop: 6,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fileRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fileLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },

  // Footer
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    paddingLeft: 2,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
})
