/* eslint-disable @typescript-eslint/no-require-imports */
import React, { useEffect, useState, useMemo } from 'react'
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
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import type { MarkdownStyle as EnrichedMarkdownStyle } from 'react-native-enriched-markdown'
import { Feather } from '@expo/vector-icons'
import type { Message, ToolInvocationSummary } from '../../services/chatTypes'
import type { Theme } from '../../constants/theme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'

type MarkdownStyle = EnrichedMarkdownStyle

const OVERLAY_LOGO = require('../../assets/overlay-logo.png')

const DONE_STATES = new Set(['output-available', 'output-error', 'output-denied'])

// ─── Think-tag extraction ─────────────────────────────────────────────────────
// Handles both <think>...</think> and <think>...</redacted_thinking> patterns.
// This runs on both streaming and loaded messages so <think> never leaks to body text.

function extractThinkContent(text: string): { cleanText: string; reasoning: string } {
  let reasoning = ''
  const cleanText = text
    .replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner: string) => {
      reasoning += inner
      return ''
    })
    .replace(/<think>([\s\S]*?)<\/redacted_thinking>/gi, (_, inner: string) => {
      reasoning += inner
      return ''
    })
    .trim()
  return { cleanText, reasoning }
}

// ─── Text normalization ───────────────────────────────────────────────────────
// Port of normalizeAgentAssistantText from the web app (core parts only).

function normalizeDisplayText(text: string): string {
  if (!text.trim()) return text
  return text.replace(/([a-z])\.([A-Z])/g, '$1. $2')
}

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

// ─── Web source extraction ────────────────────────────────────────────────────

interface WebSource {
  url: string
  title?: string
  snippet?: string
}

function extractWebSources(toolInvocations: ToolInvocationSummary[]): WebSource[] {
  const sources: WebSource[] = []
  const seen = new Set<string>()

  function tryAdd(item: unknown) {
    if (!item || typeof item !== 'object') return
    const it = item as Record<string, unknown>
    const url =
      typeof it.url === 'string'
        ? it.url
        : typeof it.link === 'string'
          ? it.link
          : null
    if (!url || seen.has(url)) return
    seen.add(url)
    sources.push({
      url,
      title: typeof it.title === 'string' ? it.title : undefined,
      snippet: typeof it.snippet === 'string' ? it.snippet : undefined,
    })
  }

  for (const tool of toolInvocations) {
    if (!DONE_STATES.has(tool.state ?? '') || !tool.toolOutput) continue
    const output = tool.toolOutput

    if (Array.isArray(output)) {
      output.forEach(tryAdd)
      continue
    }

    if (typeof output !== 'object') continue
    const obj = output as Record<string, unknown>

    if (Array.isArray(obj.results)) obj.results.forEach(tryAdd)
    if (Array.isArray(obj.sources)) obj.sources.forEach(tryAdd)
    if (Array.isArray(obj.citations)) {
      obj.citations.forEach((c) => {
        if (typeof c === 'string' && !seen.has(c)) {
          seen.add(c)
          sources.push({ url: c })
        } else {
          tryAdd(c)
        }
      })
    }
    if (typeof obj.url === 'string' && !seen.has(obj.url)) {
      seen.add(obj.url)
      sources.push({ url: obj.url, title: typeof obj.title === 'string' ? obj.title : undefined })
    }
  }

  return sources
}

function getSourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ─── Shimmer animation ────────────────────────────────────────────────────────

function useShimmerStyle() {
  const opacity = useSharedValue(0.5)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
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
    // eslint-disable-next-line react-hooks/immutability
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
      <Image source={OVERLAY_LOGO} style={styles.cursorImage} resizeMode="contain" alt="Overlay loading indicator" />
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
        <Image source={OVERLAY_LOGO} style={styles.toolLogo} resizeMode="contain" alt="Overlay" />
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
        <Image source={OVERLAY_LOGO} style={styles.toolLogo} resizeMode="contain" alt="Overlay" />
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

// ─── Sources section ──────────────────────────────────────────────────────────

function SourcesSection({ sources, theme }: { sources: WebSource[]; theme: Theme }) {
  const [expanded, setExpanded] = useState(false)
  if (sources.length === 0) return null

  return (
    <View style={[styles.sourcesBlock, { borderColor: theme.border }]}>
      <TouchableOpacity
        style={styles.sourcesHeader}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.82}
      >
        <View style={styles.sourcesHeaderLeft}>
          <Feather name="globe" size={13} color={theme.textSecondary} />
          <Text style={[styles.sourcesHeaderText, { color: theme.textSecondary }]}>
            {sources.length} source{sources.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={13}
          color={theme.textSecondary}
        />
      </TouchableOpacity>
      {expanded ? (
        <View style={[styles.sourcesList, { borderTopColor: theme.border }]}>
          {sources.map((source, i) => (
            <TouchableOpacity
              key={`${source.url}-${i}`}
              style={[styles.sourceRow, { borderBottomColor: theme.border }]}
              onPress={() => void Linking.openURL(source.url)}
              activeOpacity={0.82}
            >
              <View style={styles.sourceRowContent}>
                <Text style={[styles.sourceTitle, { color: theme.text }]} numberOfLines={1}>
                  {source.title || getSourceHostname(source.url)}
                </Text>
                {source.snippet ? (
                  <Text
                    style={[styles.sourceSnippet, { color: theme.textSecondary }]}
                    numberOfLines={2}
                  >
                    {source.snippet}
                  </Text>
                ) : null}
              </View>
              <Feather name="external-link" size={12} color={theme.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  )
}

// ─── Memoized stable markdown ─────────────────────────────────────────────────
// Only re-renders when text OR style reference changes. Since markdownStyles is
// built with useMemo (theme + isUser deps), style only changes on theme switch —
// not on every streaming chunk.

const StableMd = React.memo(
  function StableMd({
    text,
    style,
    streaming,
  }: {
    text: string
    style: MarkdownStyle
    streaming?: boolean
  }) {
    return (
      <EnrichedMarkdownText
        markdown={text}
        markdownStyle={style}
        flavor="github"
        md4cFlags={{ latexMath: true }}
        streamingAnimation={streaming}
        selectable
      />
    )
  },
  (prev, next) =>
    prev.text === next.text &&
    prev.style === next.style &&
    prev.streaming === next.streaming,
)

// Assistant replies stream chunk-by-chunk; we still render markdown on the whole string
// so lists, headings, and code fences stay coherent (newline-splitting mangled markup).

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

  const rawContent = isUser
    ? message.content
    : (message.responses?.find((r) => r.modelId === message.selectedModelId)?.content ||
       message.responses?.[0]?.content ||
       message.content)

  // Strip <think>...</think> from whatever the server sends back.
  // During streaming: aiService.ts already routes think→reasoning, so cleanText ≈ rawContent.
  // After loadChat: server returns raw model output with <think> tags → extract them here.
  const { cleanText: displayContent, reasoning: extractedReasoning } = useMemo(
    () => (isUser ? { cleanText: rawContent, reasoning: '' } : extractThinkContent(rawContent || '')),
    [isUser, rawContent],
  )

  const isLoading = message.responses?.some((r) => r.isLoading) ?? false
  const reasoningText = (message.reasoning || '') + extractedReasoning
  const hasReasoning = !isUser && !!reasoningText.trim()
  const toolInvocations: ToolInvocationSummary[] = !isUser ? (message.toolInvocations || []) : []
  const generatedFiles = !isUser ? (message.generatedFiles || []) : []

  const webSources = useMemo(
    () => extractWebSources(toolInvocations),
    // Stable until tool states change; length + last state as lightweight proxy
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toolInvocations.length, toolInvocations[toolInvocations.length - 1]?.state],
  )

  const markdownStyles = useMemo<MarkdownStyle>(
    () => ({
      paragraph: {
        color: theme.text,
        fontSize: 17,
        lineHeight: 26,
        fontFamily: 'LibreBaskerville',
        marginTop: 0,
        marginBottom: 8,
      },
      h1: {
        color: theme.text,
        fontSize: 22,
        fontWeight: '700',
        marginTop: 16,
        marginBottom: 8,
        fontFamily: 'LibreBaskerville',
      },
      h2: {
        color: theme.text,
        fontSize: 19,
        fontWeight: '600',
        marginTop: 12,
        marginBottom: 6,
        fontFamily: 'LibreBaskerville',
      },
      h3: {
        color: theme.text,
        fontSize: 17,
        fontWeight: '600',
        marginTop: 10,
        marginBottom: 4,
        fontFamily: 'LibreBaskerville',
      },
      h4: {
        color: theme.text,
        fontSize: 16,
        fontWeight: '600',
        marginTop: 8,
        marginBottom: 4,
      },
      h5: {
        color: theme.text,
        fontSize: 15,
        fontWeight: '600',
        marginTop: 6,
        marginBottom: 4,
      },
      h6: {
        color: theme.text,
        fontSize: 14,
        fontWeight: '600',
        marginTop: 6,
        marginBottom: 4,
      },
      code: {
        backgroundColor: theme.surfaceMuted,
        color: theme.text,
        fontSize: 13,
        fontFamily: 'monospace',
      },
      codeBlock: {
        backgroundColor: theme.surfaceMuted,
        borderColor: theme.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        marginTop: 8,
        marginBottom: 8,
        color: theme.text,
        fontSize: 13,
        fontFamily: 'monospace',
      },
      link: { color: '#3B82F6', underline: true },
      strong: { fontWeight: 'bold' },
      em: { fontStyle: 'italic' },
      list: {
        color: theme.text,
        fontSize: 17,
        lineHeight: 26,
        bulletColor: theme.text,
        markerColor: theme.text,
        fontFamily: 'LibreBaskerville',
      },
      blockquote: {
        backgroundColor: theme.surfaceMuted,
        borderColor: theme.border,
        borderWidth: 3,
        marginTop: 8,
        marginBottom: 8,
        color: theme.text,
        fontFamily: 'LibreBaskerville',
      },
      table: {
        borderColor: theme.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 4,
        marginTop: 8,
        marginBottom: 8,
        headerBackgroundColor: theme.surfaceMuted,
        headerTextColor: theme.text,
        rowEvenBackgroundColor: theme.surfaceSubtle,
        rowOddBackgroundColor: theme.surfaceMuted,
        color: theme.text,
      },
      thematicBreak: { color: theme.border, height: 1, marginTop: 12, marginBottom: 12 },
      math: {
        color: theme.text,
        fontSize: 17,
        marginTop: 8,
        marginBottom: 8,
        textAlign: 'center',
      },
      inlineMath: { color: theme.text },
      taskList: {
        checkedColor: theme.accent,
        borderColor: theme.border,
        checkmarkColor: theme.background,
      },
    }),
    [theme],
  )

  // ── User bubble ──────────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <Animated.View entering={FadeIn.duration(150)} style={[styles.container, styles.userContainer]}>
        <View style={[styles.userBubble, { backgroundColor: theme.surfaceSubtle }]}>
          {message.imageData ? (
            <View style={[styles.attachmentTag, { backgroundColor: theme.surfaceMuted }]}>
              <Feather name="image" size={13} color={theme.text} />
              <Text style={[styles.attachmentTagText, { color: theme.text }]}>Image attached</Text>
            </View>
          ) : null}
          <StableMd text={message.content} style={markdownStyles} streaming={false} />
        </View>
      </Animated.View>
    )
  }

  // ── Assistant bubble ─────────────────────────────────────────────────────────
  const showInitialCursor =
    isLoading && !displayContent && !hasReasoning && toolInvocations.length === 0
  const isReasoningStreaming = isLoading && !displayContent

  return (
    <View style={[styles.container, styles.assistantContainer]}>
      {/* Reasoning block */}
      {hasReasoning ? (
        <ReasoningBlock
          text={reasoningText}
          isStreaming={isReasoningStreaming}
          theme={theme}
        />
      ) : null}

      {/* Tool call rows */}
      {toolInvocations.length > 0 ? (
        <View style={{ marginTop: 8, marginBottom: 8 }}>
          {toolInvocations.map((tool, idx) => (
            <ToolCallRow
              key={tool.toolCallId || `${tool.toolName}-${idx}`}
              tool={tool}
              theme={theme}
            />
          ))}
        </View>
      ) : null}

      {/* Text content */}
      {showInitialCursor ? (
        <View style={[styles.initialCursor, { marginTop: 8 }]}>
          <StreamingCursor />
        </View>
      ) : displayContent ? (
        <View style={{ marginTop: 8 }}>
          <StableMd
            text={normalizeDisplayText(displayContent)}
            style={markdownStyles}
            streaming={isLoading}
          />
          {isLoading ? (
            <View style={styles.streamingLine}>
              <StreamingCursor />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Sources (collapsed by default) */}
      {!isLoading && webSources.length > 0 ? (
        <SourcesSection sources={webSources} theme={theme} />
      ) : null}

      {/* Generated files */}
      {generatedFiles.length > 0 ? (
        <View
          style={[
            styles.filesBlock,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
          ]}
        >
          {generatedFiles.map((file, index) => (
            <TouchableOpacity
              key={`${file.url}-${index}`}
              onPress={() => void Linking.openURL(file.url)}
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
        <View style={[styles.actions, { marginTop: 12 }]}>
          <Text style={[styles.metaLabel, { color: theme.textDisabled }]}>
            {message.responses?.[0]?.modelName || 'Overlay'}
          </Text>
          <TouchableOpacity
            onPress={() => onCopy?.(displayContent)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="copy" size={15} color={theme.textDisabled} />
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

  // Tool / reasoning rows
  toolRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
    minHeight: 28,
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
    fontSize: 15,
    lineHeight: 20,
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

  // Streaming cursor
  cursor: {
    width: 24,
    height: 24,
    marginBottom: 3,
  },
  cursorImage: {
    width: 24,
    height: 24,
  },

  // Initial loading cursor
  initialCursor: {
    paddingVertical: 8,
    paddingLeft: 2,
  },

  // Sources section
  sourcesBlock: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginTop: 8,
  },
  sourcesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sourcesHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourcesHeaderText: {
    fontSize: 12,
    fontWeight: '500',
  },
  sourcesList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sourceRowContent: {
    flex: 1,
    gap: 2,
  },
  sourceTitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  sourceSnippet: {
    fontSize: 11,
    lineHeight: 15,
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
    marginTop: 12,
    paddingLeft: 2,
  },
  metaLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
})
