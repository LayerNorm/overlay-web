import React, { useState, useMemo } from 'react'
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Image as ExpoImage } from 'expo-image'
import Animated, { FadeIn } from 'react-native-reanimated'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import type { MarkdownStyle as EnrichedMarkdownStyle } from 'react-native-enriched-markdown'
import { Feather } from '@expo/vector-icons'
import {
  buildAssistantVisualSegments,
  getDraftFromToolBlock,
  type AssistantVisualBlock,
  type AssistantVisualSegment,
  type ChatTranscriptSourceView,
  type DraftModalState,
} from '@overlay/chat-core'
import type { Message, ToolInvocationSummary } from '../../services/chatTypes'
import type { Theme } from '../../constants/theme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'
import { GeneratedUiCard } from './GeneratedUiCard'
import { ResponseMark } from './ResponseMark'
import { completeMarkdown } from '../../lib/agentThread'
import { completePersonalBlocks } from '../../lib/personalStream'

type MarkdownStyle = EnrichedMarkdownStyle


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
    .trimStart()
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
  url?: string
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
  const hasText = text.trim().length > 0
  const showContent = expanded && hasText

  return (
    <View style={styles.toolRow}>
      <View style={styles.toolContent}>
        <View style={styles.toolHeaderRow}>
          <Text style={[styles.toolLabel, { color: theme.textSecondary }]}>Reasoning</Text>
          {hasText ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Toggle reasoning" onPress={() => setExpanded(value => !value)}><Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={theme.textSecondary} /></TouchableOpacity> : null}
        </View>
        {showContent ? (
          <ScrollView
            style={[styles.reasoningScroll, { borderColor: theme.border }]}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.reasoningText, { color: theme.textSecondary }]}>
              {completeMarkdown(text, isStreaming).trim()}
            </Text>
          </ScrollView>
        ) : null}
      </View>
    </View>
  )
}

// ─── Tool call row ────────────────────────────────────────────────────────────

function ToolCallRow({ tool, theme }: { tool: ToolInvocationSummary; theme: Theme }) {
  const isError = tool.state === 'output-error' || tool.state === 'output-denied'
  const label = getToolLabel(tool.toolName)

  return (
    <View style={styles.toolRow}>
      <View style={styles.toolContent}>
        <Text style={[styles.toolLabel, { color: isError ? theme.danger : theme.textSecondary }]} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  )
}

// ─── Tool group — consecutive tool/reasoning items collapse into a count row ──

function ToolGroupBlock({
  items,
  theme,
}: {
  items: AssistantVisualBlock[]
  theme: Theme
}) {
  const [expanded, setExpanded] = useState(false)
  const tools = items.filter(
    (item): item is Extract<AssistantVisualBlock, { kind: 'tool' }> => item.kind === 'tool',
  )
  const anyRunning = tools.some((tool) => !DONE_STATES.has(tool.state ?? ''))
  const anyError = tools.some(
    (tool) => tool.state === 'output-error' || tool.state === 'output-denied',
  )

  // Small groups render inline — collapsing two rows saves nothing.
  if (tools.length <= 2) {
    return (
      <>
        {items.map((item, index) => {
          if (item.kind === 'tool') {
            return (
              <ToolCallRow
                key={item.key || `${item.name}-${index}`}
                tool={{
                  toolCallId: item.key,
                  toolName: item.name,
                  state: item.state,
                  toolInput: item.toolInput,
                  toolOutput: item.toolOutput,
                }}
                theme={theme}
              />
            )
          }
          if (item.kind === 'reasoning') {
            return (
              <ReasoningBlock
                key={item.key || `reasoning-${index}`}
                text={item.text}
                isStreaming={false}
                theme={theme}
              />
            )
          }
          return null
        })}
      </>
    )
  }

  const label = anyRunning
    ? `${tools.length} actions…`
    : anyError
      ? `${tools.length} actions — some failed`
      : `${tools.length} actions`

  return (
    <View>
      <TouchableOpacity
        style={styles.toolRow}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.82}
      >
        <View style={styles.toolContent}>
          <View style={styles.toolHeaderRow}>
            <Text
              style={[styles.toolLabel, { color: anyError ? '#EF4444' : theme.textSecondary }]}
              numberOfLines={1}
            >
              {label}
            </Text>
            <Feather
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={13}
              color={theme.textSecondary}
            />
          </View>
        </View>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.toolGroupChildren}>
          {items.map((item, index) => {
            if (item.kind === 'tool') {
              return (
                <ToolCallRow
                  key={item.key || `${item.name}-${index}`}
                  tool={{
                    toolCallId: item.key,
                    toolName: item.name,
                    state: item.state,
                    toolInput: item.toolInput,
                    toolOutput: item.toolOutput,
                  }}
                  theme={theme}
                />
              )
            }
            if (item.kind === 'reasoning') {
              return (
                <ReasoningBlock
                  key={item.key || `reasoning-${index}`}
                  text={item.text}
                  isStreaming={false}
                  theme={theme}
                />
              )
            }
            return null
          })}
        </View>
      ) : null}
    </View>
  )
}

// ─── File part — images preview inline; other files open externally ───────────

function FilePartView({
  url,
  mediaType,
  fileName,
  theme,
}: {
  url: string
  mediaType?: string
  fileName?: string
  theme: Theme
}) {
  if (mediaType?.startsWith('image/')) {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => void Linking.openURL(url)}
        style={[styles.imagePreviewWrap, { borderColor: theme.border }]}
      >
        <ExpoImage
          source={{ uri: url }}
          style={styles.imagePreview}
          contentFit="cover"
          transition={120}
        />
      </TouchableOpacity>
    )
  }

  const label = mediaType?.startsWith('video/')
    ? 'Generated video'
    : fileName || 'File'
  return (
    <TouchableOpacity
      onPress={() => void Linking.openURL(url)}
      activeOpacity={0.82}
      style={[styles.fileRow, { borderBottomColor: theme.border }]}
    >
      <View style={styles.fileRowLeft}>
        <Feather
          name={mediaType?.startsWith('video/') ? 'film' : 'link'}
          size={13}
          color={theme.textSecondary}
        />
        <Text style={[styles.fileLabel, { color: theme.text }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Feather name="external-link" size={14} color={theme.textSecondary} />
    </TouchableOpacity>
  )
}

// ─── Persisted assistant segments — output of `buildAssistantVisualSegments` ──

/** Native mirror of the web transcript's DraftSuggestionCard. */
function DraftCard({
  draft,
  theme,
  onOpen,
  onQuickSend,
}: {
  draft: DraftModalState
  theme: Theme
  onOpen?: () => void
  onQuickSend?: (text: string) => void
}) {
  const isAutomation = draft.kind === 'automation'
  return (
    <View style={[styles.draftCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
      <Text style={[styles.draftBadge, { color: theme.textSecondary, borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}>
        {isAutomation ? 'AUTOMATION DRAFT' : 'SKILL DRAFT'}
      </Text>
      <Text style={[styles.draftTitle, { color: theme.text }]}>{draft.draft.name}</Text>
      {draft.draft.description ? (
        <Text style={[styles.draftDescription, { color: theme.textSecondary }]} numberOfLines={4}>
          {draft.draft.description}
        </Text>
      ) : null}
      {draft.draft.reason ? (
        <Text style={[styles.draftReason, { color: theme.textSecondary }]} numberOfLines={2}>
          {draft.draft.reason}
        </Text>
      ) : null}
      <View style={styles.draftActions}>
        {onOpen ? (
          <TouchableOpacity onPress={onOpen} style={[styles.draftPrimary, { backgroundColor: theme.foreground }]}>
            <Text style={[styles.draftPrimaryText, { color: theme.background }]}>Review draft</Text>
          </TouchableOpacity>
        ) : null}
        {isAutomation && onQuickSend ? (
          <TouchableOpacity
            onPress={() => onQuickSend('Create automation')}
            style={[styles.draftSecondary, { borderColor: theme.border }]}
          >
            <Text style={[styles.draftSecondaryText, { color: theme.text }]}>Create automation</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  )
}

function AssistantSegmentView({
  segment,
  theme,
  markdownStyles,
  onOpenDraft,
  onQuickSend,
}: {
  segment: AssistantVisualSegment
  theme: Theme
  markdownStyles: MarkdownStyle
  onOpenDraft?: (state: DraftModalState) => void
  onQuickSend?: (text: string) => void
}) {
  switch (segment.kind) {
    case 'text':
      return (
        <View style={{ marginTop: 8 }}>
          <StableMd
            text={normalizeDisplayText(segment.block.text)}
            style={markdownStyles}
            streaming={false}
          />
        </View>
      )
    case 'reasoning':
      return (
        <ReasoningBlock
          text={segment.block.text}
          isStreaming={segment.block.state === 'streaming'}
          theme={theme}
        />
      )
    case 'tools': {
      // A lone draft_*_from_chat tool block promotes to a reviewable card —
      // mirrors the web transcript's DraftSuggestionCard.
      const onlyTools = segment.items.every((item) => item.kind === 'tool')
      if (onlyTools && segment.items.length === 1) {
        const tool = segment.items[0]
        const draft = tool.kind === 'tool' ? getDraftFromToolBlock(tool) : null
        if (draft) {
          return (
            <DraftCard
              draft={draft}
              theme={theme}
              onOpen={onOpenDraft ? () => onOpenDraft(draft) : undefined}
              onQuickSend={onQuickSend}
            />
          )
        }
      }
      return (
        <View style={{ marginTop: 8, marginBottom: 8 }}>
          <ToolGroupBlock items={segment.items} theme={theme} />
        </View>
      )
    }
    case 'file':
      return (
        <View style={{ marginTop: 8 }}>
          <FilePartView
            url={segment.block.url}
            mediaType={segment.block.mediaType}
            theme={theme}
          />
        </View>
      )
    case 'generated-ui':
      return <GeneratedUiCard part={segment.block.part} theme={theme} />
    default:
      return null
  }
}

/** Transcript `source` blocks → SourcesSection rows (urls link; documents don't). */
function transcriptSourcesToWebSources(
  sources: ChatTranscriptSourceView[] | undefined,
): WebSource[] {
  if (!sources?.length) return []
  return sources.map((source) => ({
    url: source.url,
    title: source.title || source.filename || source.url,
  }))
}

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
              key={`${source.url ?? source.title ?? i}-${i}`}
              style={[styles.sourceRow, { borderBottomColor: theme.border }]}
              onPress={source.url ? () => void Linking.openURL(source.url!) : undefined}
              activeOpacity={0.82}
              disabled={!source.url}
            >
              <View style={styles.sourceRowContent}>
                <Text style={[styles.sourceTitle, { color: theme.text }]} numberOfLines={1}>
                  {source.title || (source.url ? getSourceHostname(source.url) : 'Source')}
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
              {source.url ? (
                <Feather name="external-link" size={12} color={theme.textSecondary} />
              ) : null}
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
        streamingAnimation={false}
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
  /** Long-press action — parent presents the message action sheet (Reply/Copy). */
  onLongPress?: (message: Message) => void
  /** Skill/automation drafts surfaced from draft_*_from_chat tool blocks. */
  onOpenDraft?: (state: DraftModalState) => void
  /** Sends a preset user message — web's quick "Create automation" draft action. */
  onQuickSend?: (text: string) => void
}

export const MessageBubble = React.memo(function MessageBubble({
  message,
  theme,
  onCopy,
  onLongPress,
  onOpenDraft,
  onQuickSend,
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
  const completeContent = completeMarkdown(displayContent, isLoading)
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
        fontSize: 14,
        lineHeight: 24,
        fontFamily: 'Geist',
        marginTop: 0,
        marginBottom: 16,
      },
      h1: {
        color: theme.text,
        fontSize: 22,
        fontWeight: '700',
        marginTop: 16,
        marginBottom: 8,
        fontFamily: 'Geist',
      },
      h2: {
        color: theme.text,
        fontSize: 19,
        fontWeight: '600',
        marginTop: 12,
        marginBottom: 6,
        fontFamily: 'Geist',
      },
      h3: {
        color: theme.text,
        fontSize: 14,
        fontWeight: '600',
        marginTop: 10,
        marginBottom: 4,
        fontFamily: 'Geist',
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
        fontSize: 14,
        lineHeight: 24,
        bulletColor: theme.text,
        markerColor: theme.text,
        fontFamily: 'Geist',
      },
      blockquote: {
        backgroundColor: theme.surfaceMuted,
        borderColor: theme.border,
        borderWidth: 3,
        marginTop: 8,
        marginBottom: 8,
        color: theme.text,
        fontFamily: 'Geist',
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
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={onLongPress ? () => onLongPress(message) : undefined}
          delayLongPress={350}
          style={[styles.userBubble, { backgroundColor: theme.surfaceSubtle }]}
        >
          {message.replySnippet ? (
            <View style={[styles.replyChip, { borderLeftColor: theme.textDisabled }]}>
              <Text style={[styles.replyChipText, { color: theme.textSecondary }]} numberOfLines={2}>
                {message.replySnippet}
              </Text>
            </View>
          ) : null}
          {message.imageData ? (
            <View style={[styles.attachmentTag, { backgroundColor: theme.surfaceMuted }]}>
              <Feather name="image" size={13} color={theme.text} />
              <Text style={[styles.attachmentTagText, { color: theme.text }]}>Image attached</Text>
            </View>
          ) : null}
          {message.mentions && message.mentions.length > 0 ? (
            <View style={styles.userMentionsRow}>
              {message.mentions.map((mention) => (
                <View
                  key={`${mention.type}-${mention.id}`}
                  style={[styles.mentionChip, { backgroundColor: theme.surfaceMuted }]}
                >
                  <Text style={[styles.mentionChipText, { color: theme.text }]} numberOfLines={1}>
                    @{mention.name}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <StableMd text={message.content} style={markdownStyles} streaming={false} />
        </TouchableOpacity>
      </Animated.View>
    )
  }

  // ── Assistant bubble ─────────────────────────────────────────────────────────
  const isReasoningStreaming = isLoading && !displayContent
  const responseError = message.responses?.find((r) => r.error)?.error

  // Persisted messages carry the normalized transcript render model — same
  // blocks/segments the web transcript uses. Streamed messages fall back to the
  // incremental path until the post-send reload lands.
  if (message.blocks?.length) {
    const segments = buildAssistantVisualSegments(completePersonalBlocks(message.blocks, isLoading && !message.blocksAreComplete))
    const allSources = [
      ...webSources,
      ...transcriptSourcesToWebSources(message.transcriptSources),
    ]
    return (
      <TouchableOpacity
        activeOpacity={1}
        onLongPress={onLongPress ? () => onLongPress(message) : undefined}
        delayLongPress={350}
        style={[styles.container, styles.assistantContainer]}
      >
        {segments.map((segment, index) => (
          <AssistantSegmentView
            key={`${segment.kind}-${segment.originIndex ?? index}`}
            segment={segment}
            theme={theme}
            markdownStyles={markdownStyles}
            onOpenDraft={onOpenDraft}
            onQuickSend={onQuickSend}
          />
        ))}

        {allSources.length > 0 ? (
          <SourcesSection sources={allSources} theme={theme} />
        ) : null}
        {isLoading ? <ResponseMark color={theme.foreground} /> : null}

        {responseError ? (
          <View style={[styles.errorBar, { backgroundColor: theme.surfaceSubtle, borderColor: '#fca5a5' }]}>
            <Feather name="alert-circle" size={13} color="#EF4444" />
            <Text style={[styles.errorText, { color: '#B91C1C' }]} numberOfLines={3}>
              {responseError}
            </Text>
          </View>
        ) : null}

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
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity
      activeOpacity={1}
      onLongPress={onLongPress ? () => onLongPress(message) : undefined}
      delayLongPress={350}
      style={[styles.container, styles.assistantContainer]}
    >
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
      {completeContent ? (
        <View style={{ marginTop: 8 }}><StableMd text={normalizeDisplayText(completeContent)} style={markdownStyles} streaming={false} /></View>
      ) : null}
      {isLoading ? <ResponseMark color={theme.foreground} /> : null}

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
            <FilePartView
              key={`${file.url}-${index}`}
              url={file.url}
              mediaType={file.mediaType}
              theme={theme}
            />
          ))}
        </View>
      ) : null}

      {responseError ? (
        <View style={[styles.errorBar, { backgroundColor: theme.surfaceSubtle, borderColor: '#fca5a5' }]}>
          <Feather name="alert-circle" size={13} color="#EF4444" />
          <Text style={[styles.errorText, { color: '#B91C1C' }]} numberOfLines={3}>
            {responseError}
          </Text>
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
    </TouchableOpacity>
  )
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    paddingHorizontal: 24,
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
    fontSize: 14,
    fontFamily: 'Geist',
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

  // Reply chip (user messages replying to prior content)
  replyChip: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 6,
  },
  replyChipText: {
    fontSize: 12,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  userMentionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  mentionChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 160,
  },
  mentionChipText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Collapsed tool group
  toolGroupChildren: {
    marginLeft: 18,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(128,128,128,0.2)',
    paddingLeft: 8,
  },

  // Inline image preview for generated/image file parts
  imagePreviewWrap: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    maxWidth: 280,
  },
  imagePreview: {
    width: 280,
    height: 200,
  },

  // Error surface
  errorBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: 10,
    marginTop: 8,
    alignSelf: 'stretch',
    maxWidth: 420,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },

  // Draft suggestion card
  draftCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginTop: 8,
    marginBottom: 4,
    alignSelf: 'stretch',
    maxWidth: 480,
    gap: 6,
  },
  draftBadge: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    overflow: 'hidden',
  },
  draftTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    marginTop: 2,
  },
  draftDescription: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  draftReason: {
    fontSize: 11,
    lineHeight: 15,
  },
  draftActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  draftPrimary: {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftPrimaryText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  draftSecondary: {
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftSecondaryText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
})
