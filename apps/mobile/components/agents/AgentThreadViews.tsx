import { NativeSegmented } from '../navigation/NativeSegmented'
import { useHeaderHeight } from '@react-navigation/elements'
import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import { hapticSelect } from '../../lib/haptics'
import { MessageCapsule } from '../chat/MessageCapsule'
import React, { memo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from 'react-native'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
  PanelLeft,
  X,
} from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import type {
  AgentComputer,
  AgentFiles,
  AgentRecord,
} from '../../services/agentThreadService'
import type { RoomMessageRecord } from '../../lib/roomMessages'
import {
  agentMessageProjection,
  decodeRunQuestions,
  formatRunAnswers,
} from '../../lib/agentThread'
import { AgentAvatar } from '../shell/AgentAvatar'
import { creatureEyeColor, hexToRgb, themeCreatureFills } from '../../lib/agentCreature'
import { Button, IconButton, T } from '../shell/primitives'
import { WorkMarkdown } from '../work/WorkMarkdown'

export type AgentIdentity = Pick<
  AgentRecord,
  'id' | 'name' | 'isDefault' | 'avatarColor' | 'avatarShape'
>
export type AgentActions = {
  approval: (
    request: NonNullable<ReturnType<typeof agentMessageProjection>['approval']>,
    approved: boolean,
  ) => Promise<unknown>
  answer: (
    request: NonNullable<ReturnType<typeof agentMessageProjection>['question']>,
    text: string,
  ) => Promise<unknown>
}

export function AgentHeader({
  theme,
  dark,
  agent,
  title,
  onDrawer,
  onDetails,
  onOptions,
}: {
  theme: Theme
  dark: boolean
  agent: AgentIdentity
  title: string
  onDrawer: () => void
  onDetails: () => void
  onOptions: () => void
}) {
  return (
    <View
      style={{
        height: 50,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        gap: 3,
        borderBottomWidth: 1,
        borderColor: theme.border,
      }}
    >
      <IconButton
        icon={PanelLeft}
        label="Open navigation"
        theme={theme}
        onPress={onDrawer}
      />
      <T style={{ color: theme.muted, fontSize: 11 }}>Workspace</T>
      <ChevronRight size={11} color={theme.muted} />
      <T style={{ color: theme.muted, fontSize: 11 }}>Agents</T>
      <ChevronRight size={11} color={theme.muted} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${agent.name} details`}
        onPress={onDetails}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
      >
        <AgentAvatar
          agent={agent}
          dark={dark}
          foreground={theme.foreground}
          size={18}
        />
        <T style={{ color: theme.foreground, fontSize: 11 }}>{agent.name}</T>
      </Pressable>
      <ChevronRight size={11} color={theme.muted} />
      <T
        numberOfLines={1}
        style={{ flex: 1, color: theme.muted, fontSize: 11 }}
      >
        {title}
      </T>
      <IconButton
        icon={MoreHorizontal}
        label="Thread options"
        theme={theme}
        onPress={onOptions}
      />
    </View>
  )
}

export function AgentFold({
  title,
  children,
  theme,
}: {
  title: string
  children: React.ReactNode
  theme: Theme
}) {
  const [open, setOpen] = useState(false)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        onPress={() => setOpen(!open)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 6,
          alignSelf: 'flex-start',
        }}
      >
        <T style={{ color: theme.muted, fontSize: 14 }}>{title}</T>
        {open ? (
          <ChevronDown size={14} color={theme.muted} />
        ) : (
          <ChevronRight size={14} color={theme.muted} />
        )}
      </Pressable>
      {open ? (
        <View
          style={{
            padding: 12,
            backgroundColor: theme.surfaceSubtle,
            borderRadius: 14,
            borderCurve: 'continuous',
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  )
}

function AgentDecision({
  theme,
  title,
  children,
  run,
  canRespond,
}: {
  theme: Theme
  title: string
  children?: React.ReactNode
  run: (value: boolean) => Promise<unknown>
  canRespond: boolean
}) {
  const pending = useRef(false)
  const [state, set] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState('')
  const submit = async (approved: boolean) => {
    if (pending.current || state === 'sent') return
    pending.current = true
    set('busy')
    setError('')
    try {
      await run(approved)
      set('sent')
    } catch (reason) {
      set('idle')
      setError(
        reason instanceof Error ? reason.message : 'Unable to send decision.',
      )
    } finally {
      pending.current = false
    }
  }
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.border,
        gap: 10,
        marginVertical: 10,
        backgroundColor: theme.surfaceSubtle,
      }}
    >
      <T style={{ color: theme.foreground, fontWeight: '600' }}>{title}</T>
      {children}
      {error ? (
        <T accessibilityRole="alert" style={{ color: theme.foreground }}>
          {error}
        </T>
      ) : null}
      {state === 'sent' ? (
        <T style={{ color: theme.muted }}>Decision sent</T>
      ) : !canRespond ? (
        <T style={{ color: theme.muted, fontSize: 12 }}>
          Waiting for the person who started this run.
        </T>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            theme={theme}
            secondary
            disabled={state === 'busy'}
            onPress={() => void submit(true)}
          >
            Approve
          </Button>
          <Button
            theme={theme}
            disabled={state === 'busy'}
            onPress={() => void submit(false)}
          >
            Deny
          </Button>
        </View>
      )}
    </View>
  )
}

function AgentQuestion({
  request,
  userId,
  theme,
  onAnswer,
}: {
  request: NonNullable<ReturnType<typeof agentMessageProjection>['question']>
  userId: string
  theme: Theme
  onAnswer: AgentActions['answer']
}) {
  const questions = decodeRunQuestions(request.question)
  const [answers, setAnswers] = useState<Record<number, string[]>>({})
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState('')
  const lock = useRef(false)
  const valid = questions.every(
    (question, index) =>
      question.optional || answers[index]?.some((answer) => answer.trim()),
  )
  async function submit() {
    if (lock.current || !valid || state === 'sent') return
    lock.current = true
    setState('busy')
    setError('')
    try {
      await onAnswer(
        request,
        formatRunAnswers(
          questions,
          questions.map((_, index) => answers[index]),
        ),
      )
      setState('sent')
    } catch (reason) {
      setState('idle')
      setError(
        reason instanceof Error ? reason.message : 'Unable to send answer.',
      )
    } finally {
      lock.current = false
    }
  }
  if (state === 'sent')
    return (
      <T style={{ color: theme.muted, marginVertical: 12 }}>
        Answer sent. Continuing…
      </T>
    )
  return (
    <View style={{ gap: 12, paddingVertical: 12 }}>
      <T style={{ color: theme.foreground, fontWeight: '600' }}>One question</T>
      {questions.map((question, index) => (
        <View key={index} style={{ gap: 10 }}>
          <T style={{ color: theme.foreground, lineHeight: 22 }}>
            {question.prompt}
          </T>
          {question.description ? (
            <T style={{ color: theme.muted }}>{question.description}</T>
          ) : null}
          {userId === request.userId ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {question.choices?.map((choice) => (
                  <Button
                    key={choice.label}
                    theme={theme}
                    secondary={answers[index]?.includes(choice.label)}
                    disabled={state === 'busy'}
                    onPress={() =>
                      setAnswers((old) => ({
                        ...old,
                        [index]: question.multiple
                          ? old[index]?.includes(choice.label)
                            ? old[index].filter(
                                (value) => value !== choice.label,
                              )
                            : [...(old[index] ?? []), choice.label]
                          : [choice.label],
                      }))
                    }
                  >
                    {choice.label}
                  </Button>
                ))}
              </View>
              {!question.choices?.length || question.allowCustomAnswer ? (
                <TextInput
                  accessibilityLabel={`Answer: ${question.prompt}`}
                  editable={state !== 'busy'}
                  placeholder="Your answer"
                  placeholderTextColor={theme.muted}
                  value={
                    answers[index]
                      ?.filter(
                        (value) =>
                          !question.choices?.some(
                            (choice) => choice.label === value,
                          ),
                      )
                      .join(', ') ?? ''
                  }
                  onChangeText={(text) =>
                    setAnswers((old) => ({
                      ...old,
                      [index]: [
                        ...(old[index]?.filter((value) =>
                          question.choices?.some(
                            (choice) => choice.label === value,
                          ),
                        ) ?? []),
                        text,
                      ],
                    }))
                  }
                  style={{
                    color: theme.foreground,
                    fontFamily: 'Geist',
                    padding: 12,
                    borderRadius: 8,
                    borderColor: theme.border,
                    borderWidth: 1,
                  }}
                />
              ) : null}
            </>
          ) : null}
        </View>
      ))}
      {error ? (
        <T accessibilityRole="alert" style={{ color: theme.foreground }}>
          {error}
        </T>
      ) : null}
      {userId === request.userId ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            theme={theme}
            secondary
            disabled={!valid || state === 'busy'}
            onPress={() => void submit()}
          >
            Send answer
          </Button>
        </View>
      ) : (
        <T style={{ color: theme.muted }}>
          Waiting for the person who started this run.
        </T>
      )}
    </View>
  )
}

const AgentReply = memo(function AgentReply({
  message,
  agent,
  theme,
  dark,
  userId,
  actions,
  reducedMotion,
  readOnly,
}: {
  message: RoomMessageRecord
  agent: AgentIdentity
  theme: Theme
  dark: boolean
  userId: string
  actions: AgentActions
  reducedMotion?: boolean
  readOnly?: boolean
}) {
  const projection = agentMessageProjection(message)
  const working =
    message.status === 'generating' &&
    !projection.approval &&
    !projection.question &&
    !projection.remoteRequest
  const toolCount = projection.blocks.filter((block) => block.kind === 'tool').length
  const replyText = projection.blocks
    .filter((block) => block.kind === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
  return (
    <View style={{ gap: 4 }}>
      {projection.blocks.map((block, index) =>
        block.kind === 'text' ? (
          block.text ? (
            <View key={index}>
              <WorkMarkdown text={block.text} theme={theme} variant="chat" />
            </View>
          ) : null
        ) : block.kind === 'tool' ? (
          <AgentFold key={index} theme={theme} title={block.name}>
            <T selectable style={{ color: theme.muted, fontSize: 12 }}>
              {JSON.stringify(
                { input: block.toolInput, output: block.toolOutput },
                null,
                2,
              )}
            </T>
          </AgentFold>
        ) : block.kind === 'reasoning' ? (
          <AgentFold key={index} theme={theme} title="Reasoning">
            <WorkMarkdown text={block.text} theme={theme} />
          </AgentFold>
        ) : null,
      )}
      {working ? (
        <View style={{ paddingTop: 6 }}>
          <AgentAvatar
            agent={agent}
            dark={dark}
            foreground={theme.foreground}
            size={24}
            working
            reducedMotion={reducedMotion}
          />
        </View>
      ) : null}
      {message.status !== 'generating' && replyText ? (
        <ReplyActions
          theme={theme}
          text={replyText}
          workedFor={
            message.updatedAt && message.updatedAt > message.createdAt
              ? `Worked for ${formatDuration(message.updatedAt - message.createdAt)}${toolCount ? ` · ${toolCount} ${toolCount === 1 ? 'step' : 'steps'}` : ''}`
              : undefined
          }
        />
      ) : null}
      {projection.approval ? (
        <AgentDecision
          key={projection.approval.token}
          title="Agent needs your approval"
          theme={theme}
          canRespond={!readOnly && userId === projection.approval.userId}
          run={(approved) => actions.approval(projection.approval!, approved)}
        >
          <AgentFold
            title={projection.approval.requests
              .map((request) => request.toolName)
              .join(', ')}
            theme={theme}
          >
            <T selectable style={{ color: theme.muted, fontSize: 12 }}>
              {JSON.stringify(
                projection.approval.requests.map((request) => ({
                  tool: request.toolName,
                  input: request.input,
                })),
                null,
                2,
              )}
            </T>
          </AgentFold>
        </AgentDecision>
      ) : null}
      {projection.question && !readOnly ? (
        <AgentQuestion
          key={projection.question.token}
          request={projection.question}
          userId={userId}
          theme={theme}
          onAnswer={actions.answer}
        />
      ) : null}
      {message.status === 'error' ? (
        <T accessibilityRole="alert" style={{ color: theme.muted }}>
          The response could not be completed.
        </T>
      ) : null}
    </View>
  )
})

function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`
}

/** Copy / share under a settled reply, with how long the agent worked. */
function ReplyActions({ theme, text, workedFor }: { theme: Theme; text: string; workedFor?: string }) {
  const [copied, setCopied] = useState(false)
  const button = (symbol: string, label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
      })}
    >
      <Image source={`sf:${symbol}`} style={{ width: 16, height: 16 }} contentFit="contain" tintColor={theme.muted as string} />
    </Pressable>
  )
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -7 }}>
      {button(copied ? 'checkmark' : 'square.on.square', copied ? 'Copied' : 'Copy reply', () => {
        void Clipboard.setStringAsync(text)
        hapticSelect()
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      })}
      {button('square.and.arrow.up', 'Share reply', () => void Share.share({ message: text }))}
      {workedFor ? (
        <T style={{ marginLeft: 6, color: theme.mutedLight, fontSize: 13 }}>{workedFor}</T>
      ) : null}
    </View>
  )
}

/**
 * Your messages to an agent wear its body color, so each conversation reads as
 * that agent's. The default Overlay agent is monochrome and keeps the neutral
 * bubble; text contrast follows the creature's eye rule.
 */
function agentBubbleColors(
  agent: { isDefault?: boolean; avatarColor?: string },
  dark: boolean,
  theme: Theme,
): { background: string; text: string } {
  // Unparseable (non-hex) colors keep the neutral bubble rather than guess contrast.
  if (agent.isDefault || !agent.avatarColor || !hexToRgb(agent.avatarColor)) {
    return { background: theme.surfaceSubtle as string, text: theme.foreground as string }
  }
  const fills = themeCreatureFills(agent.avatarColor)
  const background = dark ? fills.dark : fills.light
  return { background, text: creatureEyeColor(background) }
}

export function AgentThreadView({
  agent,
  messages,
  theme,
  dark,
  userId,
  actions,
  onSend,
  onStop,
  canSend = true,
  error,
  reducedMotion,
  onOlder,
}: {
  agent: AgentIdentity
  messages: RoomMessageRecord[]
  theme: Theme
  dark: boolean
  userId: string
  actions: AgentActions
  onSend: (text: string, nonce: string) => Promise<unknown>
  onStop: (id: string) => Promise<unknown>
  canSend?: boolean
  error?: string
  reducedMotion?: boolean
  onOlder?: () => void
}) {
  const headerHeight = useHeaderHeight()
  const bubble = agentBubbleColors(agent, dark, theme)
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const lock = useRef(false)
  const nonce = useRef<string | null>(null)
  const scroll = useRef<ScrollView>(null)
  const follow = useRef(true)
  const generating = messages.findLast(
    (message) => message.status === 'generating',
  )
  async function send() {
    if (!draft.trim() || lock.current || !canSend) return
    lock.current = true
    setBusy(true)
    setFailure('')
    nonce.current ??= `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`
    // Clear the field right away; the text comes back if sending fails.
    const text = draft
    setDraft('')
    follow.current = true
    try {
      await onSend(text, nonce.current)
      nonce.current = null
    } catch (reason) {
      setDraft((current) => current || text)
      setFailure(
        reason instanceof Error ? reason.message : 'Could not send message.',
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function stop() {
    if (!generating || lock.current) return
    lock.current = true
    setStopping(true)
    setFailure('')
    try {
      await onStop(generating.id)
    } catch (reason) {
      setFailure(
        reason instanceof Error ? reason.message : 'Unable to stop response.',
      )
    } finally {
      lock.current = false
      setStopping(false)
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24, gap: 26, flexGrow: 1 }}
        onContentSizeChange={() => {
          if (follow.current) scroll.current?.scrollToEnd({ animated: false })
        }}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } =
            event.nativeEvent
          follow.current =
            contentSize.height - contentOffset.y - layoutMeasurement.height < 90
        }}
        scrollEventThrottle={100}
        keyboardShouldPersistTaps="handled"
      >
        {onOlder ? (
          <Button
            theme={theme}
            onPress={() => {
              follow.current = false
              onOlder()
            }}
          >
            Load earlier messages
          </Button>
        ) : null}
        {!messages.length ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 40 }}>
            <AgentAvatar agent={agent} dark={dark} foreground={theme.foreground} size={96} working reducedMotion={reducedMotion} />
            <T style={{ color: theme.foreground, fontSize: 22, fontFamily: 'GeistMedium', letterSpacing: -0.4 }}>
              {agent.name}
            </T>
            <T style={{ color: theme.muted, fontSize: 15, textAlign: 'center' }}>
              Hand me a task to get started.
            </T>
          </View>
        ) : null}
        {messages
          .filter((message) => !message.deletedAt)
          .map((message) =>
            message.authorKind === 'human' ? (
              <View
                key={message.id}
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '82%',
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: bubble.background,
                  borderRadius: 22,
                  borderCurve: 'continuous',
                }}
              >
                <T selectable style={{ color: bubble.text, fontSize: 16, lineHeight: 22 }}>
                  {message.content}
                </T>
              </View>
            ) : (
              <AgentReply
                readOnly={!canSend}
                key={message.id}
                message={message}
                agent={agent}
                theme={theme}
                dark={dark}
                userId={userId}
                actions={actions}
                reducedMotion={reducedMotion}
              />
            ),
          )}
      </ScrollView>
      {error || failure ? (
        <T
          accessibilityRole="alert"
          style={{
            paddingHorizontal: 20,
            paddingVertical: 8,
            color: theme.foreground,
          }}
        >
          {failure || error}
        </T>
      ) : null}
      {canSend ? (
        <MessageCapsule
          value={draft}
          onChangeText={(text) => {
            setDraft(text)
            nonce.current = null
          }}
          placeholder={`Message ${agent.name}`}
          onSend={() => void send()}
          onStop={() => void stop()}
          generating={Boolean(generating)}
          sending={busy || stopping}
        />
      ) : null}
    </KeyboardAvoidingView>
  )
}

export function AgentDetailsView({
  agent,
  computer,
  computerError,
  files,
  onFile,
  theme,
  dark,
  onWeb,
  onEdit,
  onClose,
}: {
  agent: AgentRecord
  computer: AgentComputer | null | undefined
  computerError?: boolean
  files?: AgentFiles
  onFile?: (file: NonNullable<AgentFiles>[number]) => void
  theme: Theme
  dark: boolean
  onWeb: () => void
  onEdit: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState('Details')
  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        padding: 20,
        paddingBottom: 34,
        minHeight: 430,
      }}
    >
      <View
        style={{
          alignSelf: 'center',
          width: 32,
          height: 4,
          borderRadius: 3,
          backgroundColor: theme.border,
          marginBottom: 14,
        }}
      />
      <View
        style={{
          flexDirection: 'row',
          gap: 14,
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <AgentAvatar
          agent={agent}
          dark={dark}
          foreground={theme.foreground}
          size={52}
        />
        <View style={{ flex: 1, gap: 5 }}>
          <T
            style={{ color: theme.foreground, fontSize: 23, fontWeight: '600' }}
          >
            {agent.name}
          </T>
          <T style={{ color: theme.muted, fontSize: 12 }}>
            {agent.isDefault ? 'Your AI Chief of Staff.' : agent.description}
          </T>
        </View>
        <IconButton
          icon={X}
          label="Close agent details"
          theme={theme}
          onPress={onClose}
        />
      </View>
      <NativeSegmented
        value={tab}
        onChange={setTab}
        options={['Details', 'Library', 'Computer'].map((value) => ({ label: value, value }))}
      />
      {tab === 'Details' ? (
        <>
          <T style={{ color: theme.muted, lineHeight: 22, marginVertical: 20 }}>
            {agent.description ||
              'Keeps work moving, connects the dots, and brings you in when it matters.'}
          </T>
          {[
            ['Model', agent.modelId || 'Auto'],
            [
              'Access',
              agent.visibility === 'creator' ? 'Only me' : 'Workspace',
            ],
            ['Tools', `${agent.allowedToolIds.length} enabled`],
          ].map(([label, value]) => (
            <View
              key={label}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderColor: theme.border,
              }}
            >
              <T style={{ color: theme.muted, fontSize: 13 }}>{label}</T>
              <T style={{ color: theme.foreground, fontSize: 13 }}>{value}</T>
            </View>
          ))}
          {agent.canEdit ? (
            <Button theme={theme} onPress={onEdit}>
              Edit agent
            </Button>
          ) : null}
        </>
      ) : tab === 'Library' ? (
        <ScrollView
          style={{ maxHeight: 300 }}
          contentContainerStyle={{ paddingVertical: 20, gap: 12 }}
        >
          {files?.length ? (
            files.map((file) => (
              <Button
                key={file._id}
                secondary
                theme={theme}
                onPress={() => onFile?.(file)}
              >
                {file.name}
              </Button>
            ))
          ) : (
            <T style={{ color: theme.muted }}>
              {files === undefined
                ? 'Loading files…'
                : files === null
                  ? 'Could not load files.'
                  : 'No files yet'}
            </T>
          )}
        </ScrollView>
      ) : (
        <View
          style={{
            padding: 18,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 10,
            marginTop: 20,
            gap: 12,
          }}
        >
          <T style={{ color: theme.foreground, fontWeight: '600' }}>
            {computerError
              ? 'Computer status unavailable'
              : computer === undefined
                ? 'Loading computer status…'
                : computer
                  ? `Computer ${computer.status}`
                  : 'No computer connected'}
          </T>
          <T style={{ color: theme.muted, fontSize: 12 }}>
            Open on web to view the desktop.
          </T>
          <Button theme={theme} secondary icon={ExternalLink} onPress={onWeb}>
            Open on web
          </Button>
        </View>
      )}
    </View>
  )
}

