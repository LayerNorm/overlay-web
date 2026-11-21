'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai'
import { CloudOff, Folder, FolderPlus, KeyRound, Laptop, MoreHorizontal, Trash2, Check, ChevronDown } from 'lucide-react'
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, toast,
} from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { MarkdownMessage, UserMessageBubble, Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationBody, ConfirmationIcon, ConfirmationRequest, ConfirmationTitle } from '@overlay/chat-react'
import { AssistantVisualBlocks } from '@overlay/chat-react/transcript'
import { buildAssistantVisualSequence } from '@overlay/chat-core'
import type { LocalThread, WorkspaceAgentLike } from './private-thread-types'
import { AgentCreature } from '@/components/orb/Creature'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useLocalModelKeys, useLocalThreadOwner, useLocalThreadsBridge, type LocalThreadOwner } from '@/components/desktop/useLocalThreads'
import { useThisComputer } from '@/components/desktop/useThisComputer'
import { folderName } from '@/components/desktop/this-computer'
import { ChatComposer } from '../ChatComposer'
import type { MentionInputHandle } from '../chat-interface/MentionInput'
import { CloudSyncChoice, NotSyncedLabel } from './CloudSyncChoice'
import { DesktopChatTransport, type PrivateTurnSettings } from './desktop-chat-transport'
import { usePrivateModel } from './usePrivateModel'
import { usePrivateThreadSwitch } from './usePrivateThreadSwitch'
import type { DesktopBridge } from '@overlay/desktop-bridge'

const NOOP = () => {}

/**
 * A thread that runs and is stored only on this computer (internal/develop/private-threads.md). It uses the same
 * header, transcript blocks and composer as a synced agent thread; the agent loop runs in the desktop app.
 */
export function PrivateThreadExperience({ threadId, workspaceId, agent, headerActions }: {
  threadId: string
  workspaceId: string
  agent: WorkspaceAgentLike
  headerActions?: ReactNode
}) {
  const bridge = useLocalThreadsBridge()
  const owner = useLocalThreadOwner(workspaceId)
  const [loaded, setLoaded] = useState<{ thread: LocalThread; messages: UIMessage[]; running: boolean } | 'missing' | null>(null)

  useEffect(() => {
    if (!bridge || !owner) return
    let live = true
    bridge.call('localThreads.get', { owner, threadId })
      .then((result) => { if (live) setLoaded({ ...result, messages: result.messages as unknown as UIMessage[] }) })
      .catch(() => { if (live) setLoaded('missing') })
    return () => { live = false }
  }, [bridge, owner, threadId])

  if (!bridge || !owner) {
    return <PrivateNotice title="This thread is private" body="It runs and is stored only on the computer it was started on. Open Overlay on that computer to read it." />
  }
  if (loaded === 'missing') {
    return <PrivateNotice title="This thread isn’t on this computer" body="Private threads stay on the computer they were started on, for the account that started them." />
  }
  if (!loaded) return null
  return <PrivateThreadView key={threadId} bridge={bridge} owner={owner} agent={agent} initial={loaded} headerActions={headerActions} />
}

function PrivateNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <CloudOff size={20} strokeWidth={1.75} className="mx-auto mb-3 text-(--muted)" />
        <p className="text-sm text-(--foreground)">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-(--muted-light)">{body}</p>
      </div>
    </div>
  )
}

function PrivateThreadView({ bridge, owner, agent, initial, headerActions }: {
  bridge: DesktopBridge
  owner: LocalThreadOwner
  agent: WorkspaceAgentLike
  initial: { thread: LocalThread; messages: UIMessage[]; running: boolean }
  headerActions?: ReactNode
}) {
  const router = useRouter()
  const { capabilities } = useOverlayCapabilities()
  const [thread, setThread] = useState(initial.thread)
  const threadId = thread.id
  const { keys } = useLocalModelKeys()
  const model = usePrivateModel(bridge, keys, agent.modelId)
  const resolvedModel = model.resolved
  const turnSettings = useMemo<PrivateTurnSettings | null>(() => resolvedModel ? {
    model: resolvedModel,
    agent: { name: agent.name, ...(agent.instructions ? { instructions: agent.instructions } : {}) },
    approvalMode: 'ask',
  } : null, [agent.instructions, agent.name, resolvedModel])
  // One transport per thread; it sends with the model chosen at send time.
  const [transport] = useState(() => new DesktopChatTransport({ bridge, owner, threadId }))
  useEffect(() => { transport.applySettings(turnSettings) }, [transport, turnSettings])
  const chat = useChat({
    id: threadId,
    messages: initial.messages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (error) => toast.error(error.message || 'The model call failed.'),
  })
  const { messages, status, sendMessage, stop, setMessages, addToolApprovalResponse } = chat
  const [runningElsewhere, setRunningElsewhere] = useState(initial.running)
  const running = status === 'submitted' || status === 'streaming' || runningElsewhere
  const runningElsewhereRef = useRef(runningElsewhere)
  useEffect(() => { runningElsewhereRef.current = runningElsewhere }, [runningElsewhere])

  // Title and model changes come from the desktop app; a reply that was running when the page opened is read from disk.
  useEffect(() => {
    const offThreads = bridge.on('localThreads.threads', () => {
      void bridge.call('localThreads.get', { owner, threadId }).then((result) => setThread(result.thread)).catch(NOOP)
    })
    const offTurn = bridge.on('localThreads.turn', (event) => {
      if (event.threadId !== threadId || event.state === 'running' || !runningElsewhereRef.current) return
      void bridge.call('localThreads.get', { owner, threadId }).then((result) => {
        setMessages(result.messages as unknown as UIMessage[])
        setRunningElsewhere(false)
      }).catch(NOOP)
    })
    return () => { offThreads(); offTurn() }
  }, [bridge, owner, setMessages, threadId])

  const [input, setInput] = useState('')
  const [inputRevision, setInputRevision] = useState(0)
  const textareaRef = useRef<MentionInputHandle | null>(null)
  const send = useCallback(() => {
    const text = input.trim()
    if (!text || running) return
    if (!turnSettings) return
    setInput('')
    setInputRevision((value) => value + 1)
    void sendMessage({ text })
  }, [input, running, sendMessage, turnSettings])

  const started = messages.length > 0
  const footer = (
    <PrivateThreadFooter
      bridge={bridge}
      thread={thread}
      started={started}
      busy={running}
      onFolder={async (folder) => {
        try {
          setThread((await bridge.call('localThreads.update', { owner, threadId, folder })).thread)
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Couldn’t use that folder.')
        }
      }}
    />
  )
  const [deleting, setDeleting] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages])

  return (
    <AppScreenShell contentClassName="flex min-h-0">
      <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <AppScreenHeader
          title={thread.title}
          breadcrumbs={[{ label: agent.name, leading: <AgentCreature agent={agent} size={22} isDefault={agent.isDefault} working={running} /> }]}
          actions={(
            <div className="flex items-center gap-1">
              {headerActions}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Thread options"><MoreHorizontal size={16} /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => setDeleting(true)} className="gap-2 text-xs text-destructive">
                    <Trash2 size={14} strokeWidth={1.75} />
                    Delete from this computer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        />
        <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[896px] flex-col gap-4 px-3 py-6 lg:px-0">
              {messages.map((message) => message.role === 'user'
                ? <PrivateUserMessage key={message.id} message={message} />
                : message.role === 'assistant'
                  ? <PrivateAgentMessage key={message.id} message={message} agent={agent}
                      streaming={running && message.id === messages.at(-1)?.id}
                      onApprove={(id, approved) => void addToolApprovalResponse({ id, approved })} />
                  : null)}
              {status === 'error' && chat.error ? <p role="alert" className="text-sm text-destructive">{chat.error.message}</p> : null}
            </div>
          </div>
          {!model.loading && !model.resolved
            ? <AddKeyNotice text={`${agent.name} uses ${model.modelName}. To run it on this computer, add an ${model.keyNames} key. Keys stay in this computer’s keychain.`} />
            : null}
          <ChatComposer
            mode="chat"
            surface={{ hideModeMenu: true, hideGenerationModes: true, textOnly: true, placeholder: 'What do you want to get done?' }}
            emptyState={{ showCenteredEmptyChat: false, greetingLine: '' }}
            attachments={{
              attachedImages: [], setAttachedImages: NOOP, pendingChatDocuments: [], removePendingDocument: NOOP,
              attachmentError: null, fileInputRef: { current: null }, docInputRef: { current: null },
              onAddImages: NOOP, onAddDocumentsFromPicker: NOOP, onOpenAttachmentPreview: NOOP, onOpenFilePreview: NOOP,
            }}
            runtime={{
              composerNotice: null, isSendBlocked: !turnSettings, isActiveLoading: running, isTemporaryChat: false,
              blockedComposerContent: null, afterComposerContent: footer,
            }}
            inputState={{
              replyContext: null, setReplyContext: NOOP, textareaRef, input, inputRevision,
              onInputChange: setInput, onMentionsChange: NOOP, onPaste: NOOP, hasComposerText: Boolean(input.trim()),
            }}
            toolState={{
              showAttachMenu: false, setShowAttachMenu: NOOP, attachMenuRef: { current: null }, selectedToolIds: [],
              memoryEnabled: false, capabilities: { ...capabilities, memory: false, vectorSearch: false },
              onToggleTool: NOOP, onToggleMemory: NOOP, onRemoveTool: NOOP,
            }}
            modeState={{
              onModeChange: NOOP, generationChip: null, setGenerationChip: NOOP, showModeMenu: false,
              setShowModeMenu: NOOP, modeMenuRef: { current: null }, onNavigateMode: NOOP,
            }}
            actions={{
              onStop: () => {
                if (runningElsewhere) void bridge.call('localThreads.stop', { owner, threadId }).catch(NOOP)
                else void stop()
              },
              onSend: send,
            }}
          />
        </AppScreenBody>
      </div>
      <ConfirmDialog
        isOpen={deleting}
        title="Delete this thread?"
        description="It is removed from this computer. Private threads have no other copy, so this can’t be undone."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false)
          void bridge.call('localThreads.delete', { owner, threadId }).then(() => {
            router.replace(`${window.location.pathname}?agent=${encodeURIComponent(thread.agentId)}`)
          }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'Couldn’t delete the thread.'))
        }}
      />
    </AppScreenShell>
  )
}

function AddKeyNotice({ text }: { text: string }) {
  const router = useRouter()
  return (
    <div className="mx-auto w-full max-w-[896px] px-3 lg:px-0">
      <div role="note" className="mx-3 mb-1 flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface-subtle) px-3 py-2 sm:mx-4">
        <KeyRound size={14} strokeWidth={1.75} className="shrink-0 text-(--muted)" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-(--muted)">{text}</p>
        <Button variant="ghost" size="xs" className="shrink-0 text-xs" onClick={() => router.push('/app/settings?section=desktop')}>Add a key</Button>
      </div>
    </div>
  )
}

function PrivateUserMessage({ message }: { message: UIMessage }) {
  const text = message.parts.map((part) => part.type === 'text' ? part.text : '').join('\n').trim()
  if (!text) return null
  return (
    <div className="flex justify-end">
      <div className="flex min-w-0 max-w-[min(92%,36rem)] flex-col items-end sm:max-w-[75%]">
        <UserMessageBubble className="ml-auto max-w-full" contentClassName="whitespace-normal">
          <MarkdownMessage text={text} isStreaming={false} />
        </UserMessageBubble>
      </div>
    </div>
  )
}

type ApprovalPart = { type: string; toolCallId: string; state: string; input?: unknown; approval?: { id: string } }

function PrivateAgentMessage({ message, agent, streaming, onApprove }: {
  message: UIMessage
  agent: WorkspaceAgentLike
  streaming: boolean
  onApprove(id: string, approved: boolean): void
}) {
  const blocks = useMemo(() => buildAssistantVisualSequence(message.parts), [message.parts])
  const pending = (message.parts as unknown as ApprovalPart[])
    .filter((part) => part.type.startsWith('tool-') && part.state === 'approval-requested' && part.approval)
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0"><AgentCreature agent={agent} size={24} isDefault={agent.isDefault} working={streaming} /></div>
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 text-[13px] font-medium text-(--foreground)">{agent.name}</p>
        <AssistantVisualBlocks
          blocks={blocks}
          blockKeyPrefix={message.id}
          markdownKeyPrefix={message.id}
          isStreaming={streaming}
          isTextStreaming={streaming}
          suppressTypingIndicator
          onOpenDraft={NOOP}
          onCreateAutomationDraft={NOOP}
        />
        {pending.map((part) => (
          <Confirmation key={part.toolCallId} className="mt-2">
            <ConfirmationIcon running={false} />
            <ConfirmationBody>
              <ConfirmationTitle>Agent needs your approval</ConfirmationTitle>
              <ConfirmationRequest>{part.type.slice('tool-'.length)}</ConfirmationRequest>
              <details className="mt-2 text-xs text-(--muted)">
                <summary className="cursor-pointer">Action details</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(part.input, null, 2)}</pre>
              </details>
              <ConfirmationActions>
                <ConfirmationAction tone="primary" onClick={() => onApprove(part.approval!.id, true)}>Approve</ConfirmationAction>
                <ConfirmationAction onClick={() => onApprove(part.approval!.id, false)}>Deny</ConfirmationAction>
              </ConfirmationActions>
            </ConfirmationBody>
          </Confirmation>
        ))}
      </div>
    </div>
  )
}

/** This computer, the folder and Cloud sync, under the message box. The folder and sync are fixed after the first message. */
function PrivateThreadFooter({ bridge, thread, started, busy, onFolder }: {
  bridge: DesktopBridge
  thread: LocalThread
  started: boolean
  busy: boolean
  onFolder(folder: string | null): void | Promise<void>
}) {
  const thisComputer = useThisComputer(thread.workspaceId)
  const switcher = usePrivateThreadSwitch(thread.workspaceId)
  const folderLabelText = thread.folder ? folderName(thread.folder) : 'Overlay Files'
  const fixed = (icon: ReactNode, label: string) => (
    <span title="Set when the thread started" className="inline-flex h-6 min-w-0 max-w-[220px] items-center gap-1.5 px-1.5 text-[11px] text-(--muted-light)">
      {icon}<span className="truncate">{label}</span>
    </span>
  )
  if (started) {
    return (
      <div className="mt-1.5 flex min-w-0 items-center gap-0.5 px-1">
        {fixed(<Laptop size={12} strokeWidth={1.75} className="shrink-0" />, 'This computer')}
        {fixed(<Folder size={12} strokeWidth={1.75} className="shrink-0" />, folderLabelText)}
        <NotSyncedLabel />
      </div>
    )
  }
  const folders = thisComputer.folders.filter((path) => path !== thread.folder)
  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-0.5 px-1">
      {fixed(<Laptop size={12} strokeWidth={1.75} className="shrink-0" />, 'This computer')}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" aria-label="Folder this thread works in" disabled={busy} className="h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-normal text-(--muted)">
            <Folder size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{folderLabelText}</span>
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[420px] w-80 overflow-y-auto">
          <DropdownMenuItem onSelect={() => void onFolder(null)} className="gap-2 text-xs">
            <Folder size={14} strokeWidth={1.75} className="opacity-60" />
            <span className="min-w-0 flex-1 truncate">Overlay Files</span>
            {!thread.folder ? <Check size={13} /> : null}
          </DropdownMenuItem>
          {thread.folder ? (
            <DropdownMenuItem className="gap-2 text-xs">
              <Laptop size={14} strokeWidth={1.75} />
              <span className="min-w-0 flex-1"><span className="block truncate">{folderName(thread.folder)}</span><span className="block truncate text-[11px] text-(--muted-light)">{thread.folder}</span></span>
              <Check size={13} />
            </DropdownMenuItem>
          ) : null}
          {folders.map((path) => (
            <DropdownMenuItem key={path} onSelect={() => void onFolder(path)} className="gap-2 text-xs">
              <Laptop size={14} strokeWidth={1.75} />
              <span className="min-w-0 flex-1"><span className="block truncate">{folderName(path)}</span><span className="block truncate text-[11px] text-(--muted-light)">{path}</span></span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => {
            // The system folder dialog; choosing a folder there is the person's consent to work in it.
            void bridge.call('localComputer.chooseFolder', undefined).then((chosen) => { if (chosen) void onFolder(chosen.path) }).catch(NOOP)
          }} className="gap-2 text-xs text-(--muted)">
            <FolderPlus size={14} strokeWidth={1.75} />
            Choose folder…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CloudSyncChoice
        synced={false}
        disabled={busy || switcher.switching || !thisComputer.environmentId}
        onChoose={() => void switcher.makeSynced({ agentId: thread.agentId, threadId: thread.id, folder: thread.folder, environmentId: thisComputer.environmentId })}
      />
    </div>
  )
}
