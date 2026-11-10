/**
 * Native room message row — the mobile counterpart of web `RoomMessageItem`:
 * yours renders as a right-aligned bubble; received messages render as a
 * Slack-style flat row (avatar · name · time · body); agents render through
 * the shared assistant block sequence so tool calls survive.
 */
import React, { useMemo } from 'react'
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import type { MarkdownStyle } from 'react-native-enriched-markdown'
import { buildAssistantVisualSegments, type AssistantVisualSegment } from '@overlay/chat-core'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import type { RoomMessageAttachment, RoomMessageView } from '../../lib/roomMessages'
import { AgentCreature } from '../agents/AgentCreature'
import { GeneratedUiCard } from './GeneratedUiCard'

export interface RoomReactionChip {
  emoji: string
  count: number
  reactedByCurrentPrincipal: boolean
}

export interface RoomThreadTeaser {
  authorName: string
  text: string
  createdAt: number
}

function authorInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function roomMarkdownStyles(theme: Theme): MarkdownStyle {
  return {
    paragraph: { color: theme.text, fontSize: 15, lineHeight: 22, marginTop: 0, marginBottom: 6 },
    h1: { color: theme.text, fontSize: 19, fontWeight: '700', marginTop: 10, marginBottom: 6 },
    h2: { color: theme.text, fontSize: 17, fontWeight: '600', marginTop: 8, marginBottom: 4 },
    h3: { color: theme.text, fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 4 },
    code: { backgroundColor: theme.surfaceMuted, color: theme.text, fontSize: 13, fontFamily: 'monospace' },
    codeBlock: {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      marginTop: 6,
      marginBottom: 6,
      color: theme.text,
      fontSize: 13,
      fontFamily: 'monospace',
    },
    link: { color: theme.text, underline: true },
    blockquote: {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
      borderWidth: 3,
      marginTop: 6,
      marginBottom: 6,
      color: theme.textSecondary,
    },
  }
}

function AuthorAvatar({ view, theme }: { view: RoomMessageView; theme: Theme }) {
  const isAgent = view.authorKind === 'agent' || view.authorKind === 'model'
  if (isAgent) {
    return (
      <View style={styles.avatarWrap}>
        <AgentCreature
          shape={view.authorShape}
          color={view.authorColor}
          size={30}
          label={view.authorName}
        />
      </View>
    )
  }
  return (
    <View style={[styles.avatarChip, { backgroundColor: theme.surfaceMuted }]}>
      <Text style={[styles.avatarInitial, { color: theme.text }]}>
        {authorInitial(view.mine ? 'You' : view.authorName)}
      </Text>
    </View>
  )
}

function AttachmentRow({ attachment, theme }: { attachment: RoomMessageAttachment; theme: Theme }) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={() => void Linking.openURL(attachment.url).catch(() => undefined)}
      style={[styles.attachmentChip, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
    >
      <Feather name="paperclip" size={12} color={theme.textSecondary} />
      <Text style={[styles.attachmentName, { color: theme.text }]} numberOfLines={1}>
        {attachment.name}
      </Text>
    </TouchableOpacity>
  )
}

function ImageGrid({ images, theme }: { images: RoomMessageAttachment[]; theme: Theme }) {
  if (images.length === 0) return null
  return (
    <View style={styles.imageGrid}>
      {images.slice(0, 4).map((image) => (
        <TouchableOpacity
          key={image.url}
          activeOpacity={0.9}
          onPress={() => void Linking.openURL(image.url).catch(() => undefined)}
        >
          <Image
            source={{ uri: image.url }}
            style={[styles.imageThumb, { backgroundColor: theme.surfaceMuted }]}
            resizeMode="cover"
          />
        </TouchableOpacity>
      ))}
    </View>
  )
}

/** Compact renderer for agent-authored visual segments in a room row. */
function AgentBlocks({ view, theme, markdownStyles }: {
  view: RoomMessageView
  theme: Theme
  markdownStyles: MarkdownStyle
}) {
  const segments = useMemo(() => buildAssistantVisualSegments(view.blocks), [view.blocks])
  const toolCount = segments.reduce(
    (count, seg) => count + (seg.kind === 'tools' ? seg.items.length : 0),
    0,
  )

  return (
    <View>
      {segments.map((segment: AssistantVisualSegment) => {
        switch (segment.kind) {
          case 'text':
            return (
              <EnrichedMarkdownText
                key={`text-${segment.originIndex}`}
                markdown={segment.block.text}
                markdownStyle={markdownStyles}
              />
            )
          case 'file':
            return (
              <View key={`file-${segment.originIndex}`} style={{ marginTop: 4 }}>
                <AttachmentRow
                  attachment={{ url: segment.block.url, name: 'Attachment', mediaType: segment.block.mediaType }}
                  theme={theme}
                />
              </View>
            )
          case 'generated-ui':
            return (
              <View key={`gui-${segment.originIndex}`} style={{ marginTop: 6 }}>
                <GeneratedUiCard part={segment.block.part} theme={theme} />
              </View>
            )
          default:
            return null
        }
      })}
      {toolCount > 0 ? (
        <View style={styles.toolSummaryRow}>
          <Feather name="tool" size={11} color={theme.textSecondary} />
          <Text style={[styles.toolSummaryText, { color: theme.textSecondary }]}>
            {toolCount} tool call{toolCount === 1 ? '' : 's'}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

export const RoomMessageItem = React.memo(function RoomMessageItem({
  view,
  theme,
  grouped = false,
  reactions = [],
  replyCount = 0,
  threadTeaser,
  pinned = false,
  saved = false,
  onToggleReaction,
  onOpenThread,
  onLongPress,
}: {
  view: RoomMessageView
  theme: Theme
  grouped?: boolean
  reactions?: RoomReactionChip[]
  replyCount?: number
  threadTeaser?: RoomThreadTeaser | null
  pinned?: boolean
  saved?: boolean
  onToggleReaction?: (emoji: string) => void
  onOpenThread?: () => void
  onLongPress?: (view: RoomMessageView) => void
}) {
  const markdownStyles = useMemo(() => roomMarkdownStyles(theme), [theme])
  const isAgent = view.authorKind === 'agent' || view.authorKind === 'model'
  const isSystem = view.authorKind === 'system'

  const body = view.deletedAt ? (
    <Text style={[styles.deletedText, { color: theme.textSecondary }]}>Message deleted</Text>
  ) : isAgent ? (
    view.blocks.length > 0 ? (
      <AgentBlocks view={view} theme={theme} markdownStyles={markdownStyles} />
    ) : view.text ? (
      <EnrichedMarkdownText markdown={view.text} markdownStyle={markdownStyles} />
    ) : null
  ) : (
    view.text ? (
      <EnrichedMarkdownText markdown={view.text} markdownStyle={markdownStyles} />
    ) : null
  )

  const attachmentsRow = !view.deletedAt && (view.images.length > 0 || view.documentNames.length > 0) ? (
    <View style={styles.attachmentsWrap}>
      <ImageGrid images={view.images} theme={theme} />
      {view.documentNames.map((name) => (
        <AttachmentRow key={name} attachment={{ url: '', name }} theme={theme} />
      ))}
    </View>
  ) : null

  const reactionsRow = reactions.length > 0 ? (
    <View style={styles.reactionsRow}>
      {reactions.map((reaction) => (
        <TouchableOpacity
          key={reaction.emoji}
          activeOpacity={0.75}
          onPress={() => onToggleReaction?.(reaction.emoji)}
          style={[
            styles.reactionChip,
            {
              backgroundColor: reaction.reactedByCurrentPrincipal
                ? theme.surfaceMuted
                : theme.surfaceSubtle,
              borderColor: reaction.reactedByCurrentPrincipal ? theme.border : 'transparent',
            },
          ]}
        >
          <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
          <Text style={[styles.reactionCount, { color: theme.textSecondary }]}>{reaction.count}</Text>
        </TouchableOpacity>
      ))}
    </View>
  ) : null

  const threadRow = replyCount > 0 ? (
    <TouchableOpacity activeOpacity={0.75} onPress={onOpenThread} style={styles.threadTeaser}>
      <Feather name="message-square" size={12} color={theme.textSecondary} />
      <Text style={[styles.threadCount, { color: theme.textSecondary }]}>
        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
      </Text>
      {threadTeaser ? (
        <Text style={[styles.threadTeaserText, { color: theme.textSecondary }]} numberOfLines={1}>
          {threadTeaser.authorName}: {threadTeaser.text}
        </Text>
      ) : null}
    </TouchableOpacity>
  ) : null

  const metaRow = (pinned || saved || view.editedAt) && !view.deletedAt ? (
    <View style={styles.metaRow}>
      {pinned ? <Feather name="map-pin" size={10} color={theme.textSecondary} /> : null}
      {saved ? <Feather name="bookmark" size={10} color={theme.textSecondary} /> : null}
      {view.editedAt ? (
        <Text style={[styles.editedText, { color: theme.textSecondary }]}>(edited)</Text>
      ) : null}
    </View>
  ) : null

  if (isSystem) {
    return (
      <View style={styles.systemRow}>
        <Text style={[styles.systemText, { color: theme.textSecondary }]}>{view.text}</Text>
      </View>
    )
  }

  // Yours → right-aligned personal-chat-style bubble.
  if (view.mine) {
    return (
      <Pressable
        onLongPress={() => onLongPress?.(view)}
        delayLongPress={400}
        style={styles.mineRow}
      >
        <View style={[styles.mineBubble, { backgroundColor: theme.surfaceSubtle }]}>
          {body}
          {attachmentsRow}
          <View style={styles.mineMetaRow}>
            {view.delivery === 'sending' ? (
              <Text style={[styles.deliveryText, { color: theme.textSecondary }]}>Sending…</Text>
            ) : view.delivery === 'failed' ? (
              <Text style={[styles.deliveryText, { color: '#EF4444' }]}>Failed — tap and hold to retry</Text>
            ) : null}
            {metaRow}
          </View>
        </View>
        {reactionsRow}
      </Pressable>
    )
  }

  // Received → Slack-style flat row; grouped rows indent to the text column.
  return (
    <Pressable
      onLongPress={() => onLongPress?.(view)}
      delayLongPress={400}
      style={[styles.row, grouped && styles.rowGrouped]}
    >
      <View style={styles.avatarColumn}>
        {grouped ? (
          <Text style={[styles.groupedTime, { color: theme.textDisabled }]}>{timeLabel(view.createdAt)}</Text>
        ) : (
          <AuthorAvatar view={view} theme={theme} />
        )}
      </View>
      <View style={styles.rowBody}>
        {!grouped ? (
          <View style={styles.authorRow}>
            <Text style={[styles.authorName, { color: theme.text }]} numberOfLines={1}>
              {view.authorName}
            </Text>
            <Text style={[styles.authorTime, { color: theme.textSecondary }]}>
              {timeLabel(view.createdAt)}
            </Text>
            {metaRow}
          </View>
        ) : null}
        <View style={{ backgroundColor: theme.surfaceSubtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}>{body}{attachmentsRow}</View>
        {grouped ? metaRow : null}
        {reactionsRow}
        {threadRow}
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  rowGrouped: {
    paddingVertical: 1.5,
  },
  avatarColumn: {
    width: 34,
    alignItems: 'center',
    paddingTop: 2,
  },
  avatarWrap: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 13,
    fontWeight: '700',
  },
  groupedTime: {
    fontSize: 9,
    paddingTop: 5,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  authorName: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    flexShrink: 1,
  },
  authorTime: {
    fontSize: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  editedText: {
    fontSize: 10,
  },
  deletedText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  attachmentsWrap: {
    marginTop: 4,
    gap: 6,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: 260,
  },
  attachmentName: {
    fontSize: 12,
    flexShrink: 1,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  imageThumb: {
    width: 120,
    height: 120,
    borderRadius: borderRadius.md,
  },
  toolSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  toolSummaryText: {
    fontSize: 11,
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    fontSize: 11,
    fontWeight: '600',
  },
  threadTeaser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
  },
  threadCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  threadTeaserText: {
    fontSize: 12,
    flexShrink: 1,
  },
  systemRow: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: spacing.lg,
  },
  systemText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  mineRow: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  mineBubble: {
    maxWidth: '82%',
    borderRadius: borderRadius.lg,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  mineMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    marginTop: 3,
  },
  deliveryText: {
    fontSize: 10,
  },
})
