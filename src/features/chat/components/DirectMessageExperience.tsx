"use client";

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { MarkdownMessage, UserMessageBubble } from '@overlay/chat-react'
import { QuestionnaireComposerProvider } from '@overlay/chat-react/questionnaire'
import { usePathname, useRouter } from 'next/navigation'
import { agentConversationRedirect } from '@/shared/chat/chat-view-navigation'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { LinkOpenInterceptor } from './LinkOpenInterceptor'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { ChatDropOverlay } from './ChatDropOverlay'
import { NativeThreadReadOnlyFooter } from './NativeThreadReadOnlyFooter'
import { AgentAssignmentSubscription, AgentAssignmentsProvider } from './AgentAssignmentSubscription'
import { isRoomView } from './collaboration/RoomViewTabs'
import { useCollaborationRealtime } from './collaboration/CollaborationRealtimeProvider'
import { isRoomAgentResponding } from './collaboration/room-message-view'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import {
  useDirectMessageRoom,
  useRoomPanels,
} from './DirectMessageExperience.hooks'
import {
  type GuidedRoomComposer,
  AttachmentViewer,
  RoomComposer,
  RoomDialogs,
  RoomHeaderActions,
  RoomHeaderLeading,
  RoomRealtimeSubscriptions,
  RoomSidePanel,
  SurfaceReadOnlyComposer,
  surfaceReadOnlyNotice,
  RoomTranscript,
} from './DirectMessageExperience.parts'
import type { NativeThreadSafety } from './chat/useNativeThreadSafety'
import { LocalThreadNotice, ThreadFolderMenuItems, ThreadWorkFooter } from './thread-work/ThreadWorkFooter'
import { useThreadWork } from './thread-work/useThreadWork'
import { RoomTranscriptProvider } from '@/components/providers/RoomTranscriptProvider'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import { useForwardedHandlers } from './chat-composer-memo'

const NO_RENDER_FUNCTIONS = new Set<string>()

function RoomComposerArea({
  safety,
  onNewThread,
  isGuided,
  guidedComposer,
  surfacePlatform,
  composerProps,
}: {
  safety: NativeThreadSafety
  onNewThread: () => void | Promise<void>
  isGuided: boolean
  guidedComposer?: GuidedRoomComposer
  surfacePlatform?: string | null
  composerProps: Omit<Parameters<typeof RoomComposer>[0], 'guided'>
}) {
  if (safety.readOnly) return <NativeThreadReadOnlyFooter safety={safety} onNewThread={onNewThread} />
  if (isGuided && !guidedComposer) return null
  if (surfacePlatform) return <SurfaceReadOnlyComposer surfacePlatform={surfacePlatform} />
  return <RoomComposer {...composerProps} guided={guidedComposer} />
}

function shouldDisableQuestionnaireSuggestions(

  guided: boolean,
  hasSurfacePlatform: boolean,
  agentResponding: boolean,
) {
  return guided || hasSurfacePlatform || agentResponding
}

function resolveRoomRightPanel({
  panels,
  externalRightPanel,
  externalRightPanelClose,
  room,
  vm,
  roster,
  thread,
  conversationType,

  messageCtx,
}: {
  panels: ReturnType<typeof useRoomPanels>
  externalRightPanel?: ReactNode
  externalRightPanelClose?: () => void
  room: ReturnType<typeof useDirectMessageRoom>
  vm: ReturnType<typeof useDirectMessageRoom>['vm']
  roster: ReturnType<typeof useDirectMessageRoom>['roster']
  thread: ReturnType<typeof useDirectMessageRoom>['thread']
  conversationType: 'dm' | 'channel'

  messageCtx: ReturnType<typeof useDirectMessageRoom>['messageCtx']
}) {
  const roomPanelOpen = isRoomView(room.roomPanel) || (room.roomPanel === 'thread' && Boolean(vm.threadRoot))
  const closeRoomPanel = () => {
    room.setRoomPanel(null)
    thread.setThreadRootId(null)
  }
  // The attachment preview wins the slot while it is open; otherwise the room's
  // own panels share the shell surface the sources sidebar already uses.
  const rightPanel = panels.shellRightPanel ?? externalRightPanel
    ?? (roomPanelOpen ? (
      <RoomSidePanel
        roomPanel={room.roomPanel}
        conversationType={conversationType}
        title={vm.title}

        roster={roster}
        vm={vm}
        thread={thread}
        navigation={room.navigation}
        actions={room.actions}
        sendMessage={room.sendMessage}
        onAddPeople={() => room.setAddPeopleOpen(true)}
        onClosePanel={() => room.setRoomPanel(null)}
        onSelectView={room.setRoomPanel}
        ctx={messageCtx}
        readOnlyFooter={room.selectedThreadSafety.readOnly
          ? <NativeThreadReadOnlyFooter safety={room.selectedThreadSafety} onNewThread={room.startNewNativeThread} />
          : undefined}
        readOnlyNotice={room.transcript.surfacePlatform
          ? surfaceReadOnlyNotice(room.transcript.surfacePlatform)
          : undefined}
      />
    ) : null)
  const rightPanelClose = panels.shellRightPanel
    ? panels.shellRightPanelClose
    : externalRightPanel
      ? externalRightPanelClose
      : roomPanelOpen
        ? closeRoomPanel
        : undefined
  return { rightPanel, rightPanelClose }
}

function roomAgentId(vm: ReturnType<typeof useDirectMessageRoom>['vm']) {
  return vm.soloAgentParticipant && vm.headerAgent && 'id' in vm.headerAgent
    ? vm.headerAgent.id
    : undefined
}

function roomHeaderTitle(guided: boolean, title: string) {
  return guided ? 'Overlay' : title
}

function roomHeaderPresentation({
  guided,
  headerAgent,
  title,
  conversationTitle,
  leading,
}: {
  guided: boolean
  headerAgent: ReturnType<typeof useDirectMessageRoom>['vm']['headerAgent']
  title: string
  conversationTitle: string | null | undefined
  leading: ReactNode
}) {
  const activeTitle = headerAgent ? conversationTitle || title : title
  return {
    title: roomHeaderTitle(guided, activeTitle),
    breadcrumbs: headerAgent ? [{ label: headerAgent.name, leading }] : undefined,
    leading: headerAgent ? undefined : leading,
  }
}

function roomPanelIsOpen(roomPanel: string | null, hasThreadRoot: boolean) {
  return isRoomView(roomPanel as Parameters<typeof isRoomView>[0])
    || (roomPanel === 'thread' && hasThreadRoot)
}

function useExclusiveRightPanels({
  externalPanelOpen,
  roomPanelOpen,
  onExternalRightPanelClose,
  setRoomPanel,
  setThreadRootId,
}: {
  externalPanelOpen: boolean
  roomPanelOpen: boolean
  onExternalRightPanelClose?: () => void
  setRoomPanel(value: 'people' | 'pinned' | 'thread' | null): void
  setThreadRootId(value: string | null): void
}) {
  const previousPanelState = useRef({ externalPanelOpen: false, roomPanelOpen: false })
  useEffect(() => {
    const previous = previousPanelState.current
    if (externalPanelOpen && roomPanelOpen) {
      if (!previous.externalPanelOpen) {
        setRoomPanel(null)
        setThreadRootId(null)
      } else if (!previous.roomPanelOpen) {
        onExternalRightPanelClose?.()
      }
    }
    previousPanelState.current = { externalPanelOpen, roomPanelOpen }
  }, [externalPanelOpen, onExternalRightPanelClose, roomPanelOpen, setRoomPanel, setThreadRootId])
}

function GuidedPendingMessage({
  pending,
  messages,
}: {
  pending: { text: string; clientNonce: string } | null | undefined
  messages: ReturnType<typeof useDirectMessageRoom>['vm']['mainMessages']
}) {
  if (!pending || messages.some((message) => message.clientNonce === pending.clientNonce)) return null
  return (
    <div className="relative -mx-1 flex justify-end px-1 py-1" data-testid="guided-pending-message">
      <div className="flex min-w-0 max-w-[min(92%,36rem)] flex-col items-end sm:max-w-[75%]">
        <UserMessageBubble className="ml-auto max-w-full" contentClassName="whitespace-normal">
          <MarkdownMessage text={pending.text} isStreaming={false} />
        </UserMessageBubble>
      </div>
    </div>
  )
}

export function DirectMessageExperience({
  conversationId,

  conversationType = "dm",
  draft = false,
  draftTitle,
  headerActions,
  externalRightPanel,
  externalRightPanelLabel,
  externalRightPanelMode,
  externalRightPanelWidth,
  onExternalRightPanelResize,
  onExternalRightPanelClose,
  onOpenLink,
  onOpenFile,
  guided,
}: {
  conversationId: string;

  conversationType?: "dm" | "channel";
  draft?: boolean;
  draftTitle?: string;
  headerActions?: ReactNode;
  externalRightPanel?: ReactNode;
  externalRightPanelLabel?: string;
  externalRightPanelMode?: "docked" | "floating";
  externalRightPanelWidth?: number;
  onExternalRightPanelResize?: (width: number) => void;
  onExternalRightPanelClose?: () => void;
  /** Opens a link from the transcript somewhere of the caller's choosing (an agent thread's panel), instead of the room's own link panel. */
  onOpenLink?: (url: string, title?: string) => void;
  /** Shows an Overlay file linked from a reply beside the conversation; defaults to the file preview panel. */
  onOpenFile?: (fileId: string, name: string) => void;
  guided?: { footer: ReactNode; composer: GuidedRoomComposer | null; revision: number; headerActions?: ReactNode; pendingMessage?: { text: string; clientNonce: string } | null };
}) {
  recordRender('DirectMessageExperience')
  const { activeWorkspace, activeWorkspaceId } = useWorkspace()
  const { capabilities } = useOverlayCapabilities()
  const { markConversationRead } = useCollaborationRealtime()
  const { settings: appSettings } = useAppSettings()
  const router = useRouter()
  const panels = useRoomPanels({ renderAttachmentViewer: AttachmentViewer })
  const room = useDirectMessageRoom({
    conversationId,

    conversationType,
    draft,
    draftTitle,
    router,
    activeWorkspaceId,
    markConversationRead,
    onOpenAttachmentPreview: panels.openAttachmentPreview,
  })
  const { vm, roster, collab, thread, transcript, composer, roomActions, messageCtx } = room
  const pathname = usePathname()
  const agentId = roomAgentId(vm)
  // Where an agent thread runs and its folder: chosen before the first message, fixed after it.
  const threadWorkEnabled = Boolean(agentId && activeWorkspaceId && !guided)
  const threadWork = useThreadWork({
    workspaceId: activeWorkspaceId ?? null, agentId: agentId ?? null, conversationId,
    started: vm.mainMessages.length > 0, enabled: threadWorkEnabled,
  })
  // Stable while the thread's work settings are unchanged, so a streamed reply does not re-render the composer.
  const threadWorkControls = useForwardedHandlers(threadWork, NO_RENDER_FUNCTIONS)
  const threadWorkFooter = useMemo(
    () => threadWorkEnabled ? <ThreadWorkFooter controls={threadWorkControls} /> : undefined,
    [threadWorkControls, threadWorkEnabled],
  )
  const threadFolderMenuItems = useMemo(
    () => threadWorkEnabled
      ? (close: () => void) => <ThreadFolderMenuItems controls={threadWorkControls} close={close} />
      : undefined,
    [threadWorkControls, threadWorkEnabled],
  )
  const agentHref = agentConversationRedirect({ pathname: pathname ?? '', workspaceId: activeWorkspaceId, agentId, conversationId, guided: Boolean(guided),  })
  useEffect(() => { if (agentHref) router.replace(agentHref) }, [agentHref, router])
  // Guided onboarding writes to this room server-side; the live transcript shows them.
  const pendingMessage = guided?.pendingMessage

  const { rightPanel, rightPanelClose } = resolveRoomRightPanel({
    panels,
    externalRightPanel,
    externalRightPanelClose: onExternalRightPanelClose,
    room,
    vm,
    roster,
    thread,
    conversationType,

    messageCtx,
      })
      const externalPanelOpen = Boolean(externalRightPanel)
      const roomPanelOpen = roomPanelIsOpen(room.roomPanel, Boolean(vm.threadRoot))
      useExclusiveRightPanels({
        externalPanelOpen,
        roomPanelOpen,
        onExternalRightPanelClose,
        setRoomPanel: room.setRoomPanel,
        setThreadRootId: thread.setThreadRootId,
      })

  const header = roomHeaderPresentation({
    guided: Boolean(guided),
    headerAgent: vm.headerAgent,
    title: vm.title,
    conversationTitle: transcript.conversationTitle,
    leading: (
      <RoomHeaderLeading
        soloAgentParticipant={vm.soloAgentParticipant}
        headerAgent={vm.headerAgent}
        conversationType={conversationType}
        otherCount={vm.otherParticipants.length}
        surfacePlatform={transcript.surfacePlatform}
      />
    ),
  })

  return (
    <QuestionnaireComposerProvider value={composer.input} readDraft={() => composer.inputRef.current} subscribe={composer.subscribeToInput} disabled={room.nativeThreadSafety.readOnly || shouldDisableQuestionnaireSuggestions(Boolean(guided), Boolean(transcript.surfacePlatform), isRoomAgentResponding(transcript.messages, room.agentResponding))} onChange={(value) => { composer.setInput(value); composer.onComposerInput(value); composer.composerRef.current?.focus() }}>
      <LinkOpenInterceptor
        preference={appSettings.linkOpenPreference}
        onOpenInOverlay={onOpenLink ?? panels.openLinkPreview}
        onOpenFile={onOpenFile ?? ((fileId, name) => { void panels.openFilePreview(name, [fileId]) })}
      />
      <RoomRealtimeSubscriptions
        conversationId={conversationId}
        threadRootId={thread.threadRootId}
        workspaceId={activeWorkspaceId}
        onMessages={transcript.applyLiveRoomMessages}
        onRoom={transcript.applyRoomSummary}
        onPaging={transcript.setPaging}
      />
      <AgentAssignmentsProvider workspaceId={activeWorkspaceId} conversationId={conversationId}>
      <RoomTranscriptProvider value={transcript.messages}>
      <AppScreenShell
        contentClassName="flex min-h-0"
        rightPanel={rightPanel}
        rightPanelOpen={Boolean(rightPanel)}
        rightPanelWidth={panels.shellRightPanel ? panels.shellRightPanelWidth : externalRightPanel ? (externalRightPanelWidth ?? 'lg') : 380}
        rightPanelMode={panels.shellRightPanel ? panels.shellRightPanelMode : (externalRightPanelMode ?? 'docked')}
        onRightPanelClose={rightPanelClose}
        onRightPanelResize={panels.shellRightPanel ? panels.shellRightPanelResize : externalRightPanel ? onExternalRightPanelResize : undefined}
        rightPanelOverlayLabel={externalRightPanel ? externalRightPanelLabel : undefined}
      >
        <div
          className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col"
          {...composer.dropZoneProps}
        >
          {composer.isDragging && <ChatDropOverlay />}
          <AppScreenHeader
            title={header.title}
            breadcrumbs={header.breadcrumbs}
            subtitle={guided ? 'Your chief of staff' : roster.participants.length > 2 ? `${roster.participants.length} people` : vm.online > 0 ? 'Online' : undefined}
            leading={header.leading}
            actions={guided ? guided.headerActions : (
              <RoomHeaderActions
                vm={vm}
                roomSidebar={!onExternalRightPanelClose}
                collab={collab}
                roomActions={roomActions}

                headerActions={headerActions}
                roomPanel={room.roomPanel}
                setRoomPanel={room.setRoomPanel}
                menuOpen={room.menuOpen}
                setMenuOpen={room.setMenuOpen}
                menuTriggerRef={room.menuTriggerRef}
                onShare={() => room.setShareOpen(true)}
              />
            )}
          />
          <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="flex min-h-0 flex-1 flex-col">
            <RoomTranscript
              transcript={transcript}
              readMarkers={room.readMarkers}
              navigation={room.navigation}
              vm={vm}
              conversationType={conversationType}
              title={vm.title}
              channelTopic={collab.channel?.topic}
              ctx={messageCtx}
              footer={<>
                <AgentAssignmentSubscription />
                <GuidedPendingMessage pending={pendingMessage} messages={vm.mainMessages} />
                {guided?.footer}
              </>}
              hideScrollbar={Boolean(guided)}
              guided={Boolean(guided)}
            />
            {threadWork.readOnly ? <LocalThreadNotice computerName={threadWork.computerName} /> : (
            <RoomComposerArea
              safety={room.nativeThreadSafety}
              onNewThread={room.startNewNativeThread}
              isGuided={Boolean(guided)}
              guidedComposer={guided?.composer ?? undefined}
              surfacePlatform={transcript.surfacePlatform}
              composerProps={{
                composer,
                mentionCategories: vm.mentionCategories,
                capabilities,
                participantsHaveAgent: roster.participants.some((participant) => participant.principalType === 'agent'),
                memoryEnabled: room.memoryEnabled,
                setMemoryEnabled: room.setMemoryEnabled,
                setMentions: room.setMentions,
                onOpenAttachmentPreview: panels.openAttachmentPreview,
                onOpenFilePreview: panels.openFilePreview,
                footer: threadWorkFooter,
                attachMenuExtra: threadFolderMenuItems,
                queue: room.composerQueue,
              }}
            />
            )}
          </AppScreenBody>
        </div>
      </AppScreenShell>
      </RoomTranscriptProvider>
      </AgentAssignmentsProvider>

      <RoomDialogs
        panels={panels}
        roomActions={roomActions}
        activeWorkspaceId={activeWorkspaceId}
        isWorkspaceOwner={activeWorkspace?.role === 'owner'}
        shareOpen={room.shareOpen}
        onShareClose={() => room.setShareOpen(false)}
        addPeopleOpen={room.addPeopleOpen}
        onAddPeopleOpenChange={room.setAddPeopleOpen}
        conversationId={conversationId}
        conversationType={conversationType}
        title={vm.title}
        currentParticipant={vm.currentParticipant}
        participants={roster.participants}
        router={router}
        onParticipantsAdded={() => room.setAddPeopleOpen(false)}
      />
    </QuestionnaireComposerProvider>
  );
}
