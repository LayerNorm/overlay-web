import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { CapabilityCheck, ImageModel, VideoModel } from '@overlay/app-core'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import type { ChatToolRequestId } from '../../services/aiService'
import type { ChatMentionItem } from '../../services/chatTypes'
import { searchMentions } from '../../services/conversationActionsService'
import {
  chatToolOptionsForCapabilities,
  isMemoryToggleAvailable,
} from '../../lib/chatTools'
import { groupMentions, mentionIcon, mentionToRequestBody } from '../../lib/chatMentions'
import { BottomSheet, SegmentedControl } from '../ui/AppChrome'
import { GlassSurface } from '../ui/GlassSurface'
import { ListRow, Section } from '../ui/primitives'

export interface PendingDocument {
  clientId: string
  name: string
  fileIds: string[]
  status: 'uploading' | 'ready' | 'error'
  error?: string
}

export interface ComposerReplyContext {
  snippet: string
  bodyForModel: string
  replyToTurnId?: string
}

export type ComposerGenerationKind = 'image' | 'video' | null
export type ComposerRequestMode = 'chat' | 'automate'

interface ComposerProps {
  theme: Theme
  inputValue: string
  onChangeInput: (value: string) => void
  onSend: () => void
  onStop: () => void
  isSending: boolean
  sendDisabled?: boolean
  placeholder?: string
  modelLabel?: string
  onModel?: () => void
  isTemporary?: boolean

  // Attachments
  imageBase64: string | null
  onClearImage: () => void
  pendingDocuments: PendingDocument[]
  onRemoveDocument: (clientId: string) => void
  attachmentError: string | null
  onPickImage: () => void
  onPickCamera: () => void
  onPickFile: () => void

  // Mentions
  mentions: ChatMentionItem[]
  onAddMention: (item: ChatMentionItem) => void
  onRemoveMention: (item: ChatMentionItem) => void

  // Per-request tools + memory + mode
  capabilities: CapabilityCheck | null
  selectedToolIds: ChatToolRequestId[]
  onToggleTool: (id: ChatToolRequestId) => void
  memoryEnabled: boolean
  onToggleMemory: () => void
  requestMode: ComposerRequestMode
  onChangeRequestMode: (mode: ComposerRequestMode) => void

  // Media generation
  imageModels: ImageModel[]
  videoModels: VideoModel[]
  generationKind: ComposerGenerationKind
  selectedImageModelId: string | null
  selectedVideoModelId: string | null
  onSelectGeneration: (kind: ComposerGenerationKind, modelId: string | null) => void

  // Reply context
  replyContext: ComposerReplyContext | null
  onClearReply: () => void

  /** Optional ref so parents can blur/focus the field (drawer open, reply). */
  inputRef?: React.RefObject<TextInput | null>

  // ── Room (collaboration) variant ──────────────────────────────────────────
  /** Rooms provide participant lookup; global mentions return in Phase 1. */
  mentionProvider?: (query: string) => Promise<ChatMentionItem[]>
  /**
   * `'chip'` (default) turns a picked mention into a removable chip and strips
   * the `@token`; `'text'` inserts `@Name ` into the input — rooms send the
   * mention inside the message body so the server resolves principals.
   */
  mentionInsertStyle?: 'chip' | 'text'
  /** Rooms don't grant per-turn tools (addMessage carries no tool ids) — the
   *  tools button + sheet are hidden. */
  showToolsButton?: boolean
}

/** Trailing `@token` the user is actively typing — drives the mention dropdown. */
function trailingMentionQuery(text: string): string | null {
  const match = /(?:^|\s)@([\p{L}\p{N}_-]{0,40})$/u.exec(text)
  return match ? match[1] : null
}

export function Composer(props: ComposerProps): React.ReactElement {
  const {
    theme,
    inputValue,
    onChangeInput,
    onSend,
    onStop,
    isSending,
    sendDisabled,
    placeholder,
    modelLabel,
    onModel,
    isTemporary,
    imageBase64,
    onClearImage,
    pendingDocuments,
    onRemoveDocument,
    attachmentError,
    onPickImage,
    onPickCamera,
    onPickFile,
    mentions,
    onAddMention,
    onRemoveMention,
    capabilities,
    selectedToolIds,
    onToggleTool,
    memoryEnabled,
    onToggleMemory,
    requestMode,
    onChangeRequestMode,
    imageModels,
    videoModels,
    generationKind,
    selectedImageModelId,
    selectedVideoModelId,
    onSelectGeneration,
    replyContext,
    onClearReply,
    inputRef,
    mentionProvider,
    mentionInsertStyle = 'chip',
    showToolsButton = true,
  } = props

  const [attachPickerVisible, setAttachPickerVisible] = useState(false)
  const [toolsSheetVisible, setToolsSheetVisible] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)

  // ── Mention search (inline dropdown above composer) ─────────────────────────
  const mentionQuery = useMemo(() => trailingMentionQuery(inputValue), [inputValue])
  const [mentionResults, setMentionResults] = useState<ChatMentionItem[]>([])
  const [mentionSearching, setMentionSearching] = useState(false)
  const mentionSeq = useRef(0)

  useEffect(() => {
    if (mentionQuery === null) {
      const reset = setTimeout(() => { setMentionResults([]); setMentionSearching(false) }, 0)
      return () => { clearTimeout(reset); mentionSeq.current++ }
    }
    const seq = ++mentionSeq.current
    const provider = mentionProvider ?? searchMentions
    const handle = setTimeout(() => {
      setMentionSearching(true)
      void provider(mentionQuery || ' ')
        .then((items) => {
          if (seq !== mentionSeq.current) return
          setMentionResults(items.filter((item) => !mentions.some((m) => m.id === item.id && m.type === item.type)))
          setMentionSearching(false)
        })
        .catch(() => {
          if (seq !== mentionSeq.current) return
          setMentionResults([])
          setMentionSearching(false)
        })
    }, 220)
    return () => { clearTimeout(handle); mentionSeq.current++ }
  }, [mentionQuery, mentions, mentionProvider])

  const handleSelectMention = useCallback(
    (item: ChatMentionItem) => {
      if (mentionInsertStyle === 'text') {
        // Room mentions live inside the body text — replace the partial
        // `@token` with the resolved `@Name ` so `resolveMentionTargets`
        // finds the principal on send.
        onChangeInput(
          inputValue.replace(/(?:^|\s)@[\p{L}\p{N}_-]{0,40}$/u, (match) =>
            match.startsWith(' ') ? ` @${item.name} ` : `@${item.name} `,
          ),
        )
      } else {
        // Strip the `@token` the user was typing; the mention rides as a chip.
        onChangeInput(inputValue.replace(/(?:^|\s)@[\p{L}\p{N}_-]{0,40}$/u, ''))
        onAddMention(item)
      }
      setMentionResults([])
    },
    [inputValue, onAddMention, onChangeInput, mentionInsertStyle],
  )

  const mentionGroups = useMemo(() => groupMentions(mentionResults), [mentionResults])
  const showMentionList = mentionQuery !== null && (mentionSearching || mentionResults.length > 0)

  // ── Tools sheet data ────────────────────────────────────────────────────────
  const availableTools = useMemo(
    () => chatToolOptionsForCapabilities(capabilities),
    [capabilities],
  )
  const memoryAvailable = isMemoryToggleAvailable(capabilities)
  const activeToolCount = selectedToolIds.length + (memoryEnabled ? 0 : 0)
  const generationModels = generationKind === 'image' ? imageModels : videoModels
  const activeGenerationModelId = generationKind === 'image'
    ? selectedImageModelId
    : selectedVideoModelId
  const activeGenerationModel = generationModels.find((m) => m.id === activeGenerationModelId)

  const canSend = !sendDisabled && !isSending

  return (
    <View>
      {/* Mention results — inline dropdown while typing @query */}
      {showMentionList ? (
        <View
          style={[
            styles.mentionPanel,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
          ]}
        >
          {mentionSearching && mentionResults.length === 0 ? (
            <View style={styles.mentionLoading}>
              <ActivityIndicator size="small" color={theme.textSecondary} />
            </View>
          ) : (
            mentionGroups.map((group) => (
              <View key={group.type}>
                <Text style={[styles.mentionGroupLabel, { color: theme.textDisabled }]}>
                  {group.label}
                </Text>
                {group.items.slice(0, 5).map((item) => (
                  <TouchableOpacity
                    key={`${item.type}-${item.id}`}
                    style={styles.mentionRow}
                    activeOpacity={0.7}
                    onPress={() => handleSelectMention(item)}
                  >
                    <Feather name={mentionIcon(item.type)} size={14} color={theme.textSecondary} />
                    <View style={styles.mentionRowBody}>
                      <Text style={[styles.mentionRowTitle, { color: theme.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.description ? (
                        <Text style={[styles.mentionRowDesc, { color: theme.textSecondary }]} numberOfLines={1}>
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ))
          )}
        </View>
      ) : null}

      {/* Attachment bars */}
      {imageBase64 ? (
        <View style={[styles.attachmentBar, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <View style={styles.attachmentInfo}>
            <Feather name="image" size={14} color={theme.textSecondary} />
            <Text style={[styles.attachmentText, { color: theme.textSecondary }]}>Image attached</Text>
          </View>
          <TouchableOpacity
            onPress={onClearImage}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Remove attached image"
          >
            <Feather name="x" size={16} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}

      {pendingDocuments.length > 0 ? (
        <View style={styles.pendingDocsRow}>
          {pendingDocuments.map((doc) => (
            <View
              key={doc.clientId}
              style={[styles.pendingDocChip, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
            >
              <View style={styles.pendingDocChipInner}>
                <Feather name="file-text" size={13} color={theme.textSecondary} />
                <Text style={[styles.pendingDocChipText, { color: theme.text }]} numberOfLines={1}>
                  {doc.name}
                </Text>
                {doc.status === 'uploading' && <ActivityIndicator size="small" color={theme.textSecondary} />}
                {doc.status === 'ready' && <Feather name="check" size={12} color="#22c55e" />}
                {doc.status === 'error' && <Feather name="alert-circle" size={12} color="#EF4444" />}
              </View>
              <TouchableOpacity
                activeOpacity={0.65}
                onPress={() => onRemoveDocument(doc.clientId)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${doc.name}`}
              >
                <Feather name="x" size={14} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {attachmentError ? (
        <View style={[styles.attachmentErrorBar, { backgroundColor: '#fee2e2', borderColor: '#fca5a5' }]}>
          <Feather name="alert-circle" size={14} color="#EF4444" />
          <Text style={[styles.attachmentErrorText, { color: '#991b1b' }]}>{attachmentError}</Text>
        </View>
      ) : null}

      {/* Mention chips */}
      {mentions.length > 0 ? (
        <View style={styles.mentionChipsRow}>
          {mentions.map((item) => (
            <View
              key={`${item.type}-${item.id}`}
              style={[styles.mentionChip, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
            >
              <Feather name={mentionIcon(item.type)} size={12} color={theme.textSecondary} />
              <Text style={[styles.mentionChipText, { color: theme.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              <TouchableOpacity
                onPress={() => onRemoveMention(item)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove mention ${item.name}`}
              >
                <Feather name="x" size={12} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {/* Reply context bar */}
      {replyContext ? (
        <View style={[styles.replyBar, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Feather name="corner-up-left" size={13} color={theme.textSecondary} />
          <Text style={[styles.replyBarText, { color: theme.textSecondary }]} numberOfLines={2}>
            {replyContext.snippet}
          </Text>
          <TouchableOpacity
            onPress={onClearReply}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
          >
            <Feather name="x" size={15} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Active generation chip */}
      {generationKind ? (
        <View style={[styles.generationBar, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <Feather name={generationKind === 'image' ? 'image' : 'film'} size={13} color={theme.textSecondary} />
          <Text style={[styles.generationBarText, { color: theme.text }]} numberOfLines={1}>
            {generationKind === 'image' ? 'Image' : 'Video'}
            {activeGenerationModel ? ` · ${activeGenerationModel.name}` : ''}
          </Text>
          <TouchableOpacity
            onPress={() => onSelectGeneration(null, null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Clear generation mode"
          >
            <Feather name="x" size={15} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Input box */}
      <GlassSurface
        interactive
        style={[
          styles.composerBox,
          { backgroundColor: theme.surface, borderColor: composerFocused ? theme.border : theme.border },
        ]}
      >
        <TextInput
          ref={inputRef}
          value={inputValue}
          onChangeText={onChangeInput}
          onFocus={() => setComposerFocused(true)}
          onBlur={() => setComposerFocused(false)}
          placeholder={
            placeholder ??
            (isTemporary ? 'Temporary chat — nothing is saved' : 'Ask anything…')
          }
          placeholderTextColor={theme.textDisabled}
          multiline
          maxLength={10000}
          style={[styles.composerInput, { color: theme.text }]}
        />

        <View style={styles.composerFooter}>
          <View style={styles.composerLeftActions}>
            <GlassSurface interactive style={[styles.composerIconButton, { backgroundColor: theme.surfaceSubtle }]}>
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => setAttachPickerVisible(true)}
                style={styles.composerIconButton}
                accessibilityRole="button"
                accessibilityLabel="Add attachment"
              >
                <Feather name="plus" size={22} color={theme.textSecondary} />
              </TouchableOpacity>
            </GlassSurface>
            {onModel ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose model" onPress={onModel} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 5, minHeight: 36 }}><Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 12, fontFamily: 'Geist', maxWidth: 130 }}>{modelLabel ?? 'Auto'}</Text><Feather name="chevron-down" size={13} color={theme.textSecondary} /></TouchableOpacity> : null}

            {showToolsButton ? (
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => setToolsSheetVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={
                  activeToolCount > 0
                    ? `Tools and modes, ${activeToolCount} active`
                    : 'Tools and modes'
                }
                style={[
                  styles.toolsButton,
                  {
                    backgroundColor: theme.surfaceSubtle,
                    borderColor: selectedToolIds.length > 0 || generationKind ? theme.border : 'transparent',
                  },
                ]}
              >
                <Feather name="sliders" size={15} color={theme.textSecondary} />
                {activeToolCount > 0 ? (
                  <Text style={[styles.toolsButtonCount, { color: theme.textSecondary }]}>
                    {activeToolCount}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => onChangeInput(`${inputValue}@`)}
              style={[styles.toolsButton, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Insert mention"
            >
              <Feather name="at-sign" size={15} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.composerRightActions}>
            <GlassSurface interactive style={[styles.sendButton, { backgroundColor: isSending || canSend ? theme.buttonBg : theme.surfaceSubtle }]}>
              <TouchableOpacity
                onPress={() => {
                  if (isSending) {
                    onStop()
                  } else {
                    Keyboard.dismiss()
                    onSend()
                  }
                }}
                disabled={!isSending && !canSend}
                activeOpacity={0.82}
                style={[styles.sendButton, (!canSend && !isSending) && { opacity: 0.5 }]}
                accessibilityRole="button"
                accessibilityLabel={isSending ? 'Stop generating' : 'Send message'}
                accessibilityState={{ disabled: !isSending && !canSend }}
              >
                {isSending ? (
                  <Feather name="square" size={14} color={theme.buttonPrimaryText} />
                ) : (
                  <Feather name="arrow-up" size={18} color={canSend ? theme.buttonPrimaryText : theme.muted} />
                )}
              </TouchableOpacity>
            </GlassSurface>
          </View>
        </View>
      </GlassSurface>

      {/* Attach picker */}
      <BottomSheet
        theme={theme}
        visible={attachPickerVisible}
        onClose={() => setAttachPickerVisible(false)}
        title="Attach"
      >
        <Section theme={theme}>
          <ListRow
            theme={theme}
            icon="image"
            title="Photo library"
            subtitle="Attach an image to the message"
            onPress={() => {
              setAttachPickerVisible(false)
              onPickImage()
            }}
          />
          <ListRow
            theme={theme}
            icon="camera"
            title="Camera"
            subtitle="Take a photo"
            onPress={() => {
              setAttachPickerVisible(false)
              onPickCamera()
            }}
          />
          <ListRow
            theme={theme}
            icon="file"
            title="Document"
            subtitle="Index a file for this chat"
            onPress={() => {
              setAttachPickerVisible(false)
              onPickFile()
            }}
          />
        </Section>
      </BottomSheet>

      {/* Tools sheet — per-request tools, memory, mode, media generation */}
      <BottomSheet
        theme={theme}
        visible={toolsSheetVisible}
        onClose={() => setToolsSheetVisible(false)}
        title="Chat options"
      >
        {availableTools.length > 0 ? (
          <Section theme={theme} label="Tools for this turn">
            {availableTools.map((tool) => {
              const active = selectedToolIds.includes(tool.id)
              return (
                <ListRow
                  key={tool.id}
                  theme={theme}
                  icon={tool.featherIcon}
                  title={tool.label}
                  subtitle={tool.description}
                  selected={active}
                  onPress={() => onToggleTool(tool.id)}
                />
              )
            })}
          </Section>
        ) : null}

        {memoryAvailable ? (
          <Section theme={theme} label="Memory">
            <ListRow
              theme={theme}
              icon="cpu"
              title="Memory"
              subtitle={memoryEnabled ? 'Memories are used in this chat' : 'Memory is off for this chat'}
              selected={memoryEnabled}
              onPress={onToggleMemory}
            />
          </Section>
        ) : null}

        <Section theme={theme} label="Mode">
          <View style={styles.modeRow}>
            <SegmentedControl
              theme={theme}
              options={[
                { value: 'chat' as const, label: 'Chat' },
                { value: 'automate' as const, label: 'Automate' },
              ]}
              value={requestMode}
              onChange={onChangeRequestMode}
            />
          </View>
          {requestMode === 'automate' ? (
            <Text style={[styles.modeHint, { color: theme.textSecondary }]}>
              Automate turns can run tools and schedules.
            </Text>
          ) : null}
        </Section>

        {imageModels.length > 0 || videoModels.length > 0 ? (
          <Section theme={theme} label="Generate">
            {imageModels.length > 0 ? (
              <ListRow
                theme={theme}
                icon="image"
                title="Image"
                subtitle={
                  generationKind === 'image' && activeGenerationModel
                    ? activeGenerationModel.name
                    : 'Generate an image this turn'
                }
                selected={generationKind === 'image'}
                onPress={() =>
                  onSelectGeneration('image', generationKind === 'image' ? null : (selectedImageModelId ?? imageModels[0]?.id ?? null))
                }
              />
            ) : null}
            {videoModels.length > 0 ? (
              <ListRow
                theme={theme}
                icon="film"
                title="Video"
                subtitle={
                  generationKind === 'video' && activeGenerationModel
                    ? activeGenerationModel.name
                    : 'Generate a video this turn'
                }
                selected={generationKind === 'video'}
                onPress={() =>
                  onSelectGeneration('video', generationKind === 'video' ? null : (selectedVideoModelId ?? videoModels[0]?.id ?? null))
                }
              />
            ) : null}
            {generationKind ? (
              generationModels.map((model) => (
                <ListRow
                  key={model.id}
                  theme={theme}
                  title={model.name}
                  subtitle={model.provider}
                  selected={model.id === activeGenerationModelId}
                  onPress={() => onSelectGeneration(generationKind, model.id)}
                />
              ))
            ) : null}
          </Section>
        ) : null}
      </BottomSheet>
    </View>
  )
}

export { mentionToRequestBody }

const styles = StyleSheet.create({
  mentionPanel: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    marginBottom: spacing.sm,
    maxHeight: 260,
    overflow: 'hidden',
  },
  mentionLoading: {
    padding: spacing.md,
    alignItems: 'center',
  },
  mentionGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 2,
  },
  mentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  mentionRowBody: {
    flex: 1,
  },
  mentionRowTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  mentionRowDesc: {
    fontSize: 11,
  },

  attachmentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  attachmentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  attachmentText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pendingDocsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  pendingDocChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingLeft: spacing.sm,
    paddingRight: 6,
    paddingVertical: 6,
    maxWidth: 220,
  },
  pendingDocChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  pendingDocChipText: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  attachmentErrorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  attachmentErrorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },

  mentionChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  mentionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    maxWidth: 200,
  },
  mentionChipText: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },

  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  replyBarText: {
    flex: 1,
    fontSize: 12,
    fontStyle: 'italic',
  },

  generationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  generationBarText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },

  composerBox: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
  },
  composerInput: {
    fontFamily: 'Geist',
    fontSize: 14,
    lineHeight: 22,
    minHeight: 48,
    maxHeight: 140,
    paddingTop: 6,
    paddingBottom: 6,
  },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  composerLeftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  composerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  composerIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderWidth: 1,
    justifyContent: 'center',
  },
  toolsButtonCount: {
    fontSize: 11,
    fontWeight: '700',
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modeRow: {
    paddingVertical: spacing.sm,
  },
  modeHint: {
    fontSize: 11,
    paddingBottom: spacing.sm,
    paddingHorizontal: 2,
  },
})
