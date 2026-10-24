"use client";

import { useEffect, useRef, type ReactNode } from 'react'
import { MarkdownMessage, UserMessageBubble } from '@overlay/chat-react'
import { QuestionnaireComposerProvider } from '@overlay/chat-react/questionnaire'
import { usePathname, useRouter } from 'next/navigation'
import { agentConversationRedirect } from '@/shared/chat/chat-view-navigation'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { LinkOpenInterceptor } from './LinkOpenInterceptor'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useConvexAuthToken } from '@/components/providers/ConvexAuthProvider'
import { useAuth } from '@/contexts/AuthContext'
import { ChatDropOverlay } from './ChatDropOverlay'
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

function shouldDisableQuestionnaireSuggestions(
  showcase: boolean,
  guided: boolean,
  hasSurfacePlatform: boolean,
  agentResponding: boolean,
) {
  return showcase || guided || hasSurfacePlatform || agentResponding
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
  showcase,
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
  showcase: boolean
  messageCtx: ReturnType<typeof useDirectMessageRoom>['messageCtx']
}) {
  const roomPanelOpen = room.roomPanel === 'people' || room.roomPanel === 'pinned'
    || (room.roomPanel === 'thread' && Boolean(vm.threadRoot))
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
        showcase={showcase}
        roster={roster}
        vm={vm}
        thread={thread}
        navigation={room.navigation}
        actions={room.actions}
        sendMessage={room.sendMessage}
        onAddPeople={() => room.setAddPeopleOpen(true)}
        onClosePanel={() => room.setRoomPanel(null)}
        ctx={messageCtx}
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
}: {
  guided: boolean
  headerAgent: ReturnType<typeof useDirectMessageRoom>['vm']['headerAgent']
  title: string
  conversationTitle: string | null | undefined
}) {
  const activeTitle = headerAgent ? conversationTitle || title : title
  return {
    title: roomHeaderTitle(guided, activeTitle),
    breadcrumbs: headerAgent ? [{ label: headerAgent.name }] : undefined,
  }
}

function roomPanelIsOpen(roomPanel: string | null, hasThreadRoot: boolean) {
  return roomPanel === 'people' || roomPanel === 'pinned'
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
  showcase = false,
  conversationType = "dm",
  draft = false,
  draftTitle,
  headerActions,
  externalRightPanel,
  externalRightPanelLabel,
  externalRightPanelMode,
  externalRightPanelWidth,
  onExternalRightPanelClose,
  bodyOverlay,
  guided,
}: {
  conversationId: string;
  showcase?: boolean;
  conversationType?: "dm" | "channel";
  draft?: boolean;
  draftTitle?: string;
  headerActions?: ReactNode;
  externalRightPanel?: ReactNode;
  externalRightPanelLabel?: string;
  externalRightPanelMode?: "docked" | "floating";
  externalRightPanelWidth?: number;
  onExternalRightPanelClose?: () => void;
  bodyOverlay?: ReactNode;
  guided?: { footer: ReactNode; composer: GuidedRoomComposer | null; revision: number; headerActions?: ReactNode; pendingMessage?: { text: string; clientNonce: string } | null };
}) {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace()
  const { appDataCapabilities, capabilities } = useOverlayCapabilities()
  const { user: authUser } = useAuth()
  const convexAccessToken = useConvexAuthToken()
  const { refreshNotifications } = useCollaborationRealtime()
  const { settings: appSettings } = useAppSettings()
  const convexLiveSyncEnabled = !showcase
    && appDataCapabilities.provider === 'convex'
    && appDataCapabilities.requiresConvexClient
    && appDataCapabilities.supportsRealtime
  const convexRoomSubscriptionEnabled = convexLiveSyncEnabled
    && Boolean(authUser?.id && convexAccessToken && activeWorkspaceId)
  const router = useRouter()
  const panels = useRoomPanels({ renderAttachmentViewer: AttachmentViewer })
  const room = useDirectMessageRoom({
    conversationId,
    showcase,
    conversationType,
    draft,
    draftTitle,
    router,
    activeWorkspaceId,
    convexRoomSubscriptionEnabled,
    refreshNotifications,
    onOpenAttachmentPreview: panels.openAttachmentPreview,
  })
  const { vm, roster, collab, thread, transcript, composer, roomActions, messageCtx } = room
  const pathname = usePathname()
  const agentId = roomAgentId(vm)
  const agentHref = agentConversationRedirect({ pathname: pathname ?? '', workspaceId: activeWorkspaceId, agentId, conversationId, guided: Boolean(guided), showcase })
  useEffect(() => { if (agentHref) router.replace(agentHref) }, [agentHref, router])
  const { loadMessages } = transcript
  const pendingMessage = guided?.pendingMessage
  const guidedRevision = guided?.revision
  useEffect(() => {
    if (guidedRevision !== undefined) void loadMessages()
  }, [guidedRevision, loadMessages])

  const { rightPanel, rightPanelClose } = resolveRoomRightPanel({
    panels,
    externalRightPanel,
    externalRightPanelClose: onExternalRightPanelClose,
    room,
    vm,
    roster,
    thread,
    conversationType,
    showcase,
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
  })

  return (
    <QuestionnaireComposerProvider value={composer.input} readDraft={() => composer.inputRef.current} subscribe={composer.subscribeToInput} disabled={shouldDisableQuestionnaireSuggestions(showcase, Boolean(guided), Boolean(transcript.surfacePlatform), isRoomAgentResponding(transcript.messages, room.agentResponding))} onChange={(value) => { composer.setInput(value); composer.onComposerInput(value); composer.composerRef.current?.focus() }}>
      <LinkOpenInterceptor
        preference={appSettings.linkOpenPreference}
        onOpenInOverlay={panels.openLinkPreview}
      />
      <RoomRealtimeSubscriptions
        enabled={convexRoomSubscriptionEnabled}
        accessToken={convexAccessToken}
        actorUserId={authUser?.id}
        conversationId={conversationId}
        threadRootId={thread.threadRootId}
        workspaceId={activeWorkspaceId}
        onMessages={transcript.applyLiveRoomMessages}
        onPresence={roster.applyConvexPresence}
      />
      <AppScreenShell
        contentClassName="flex min-h-0"
        rightPanel={rightPanel}
        rightPanelOpen={Boolean(rightPanel)}
        rightPanelWidth={panels.shellRightPanel ? panels.shellRightPanelWidth : externalRightPanel ? (externalRightPanelWidth ?? 'lg') : 380}
        rightPanelMode={panels.shellRightPanel ? panels.shellRightPanelMode : (externalRightPanelMode ?? 'docked')}
        onRightPanelClose={rightPanelClose}
        onRightPanelResize={panels.shellRightPanel ? panels.shellRightPanelResize : undefined}
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
            leading={(
              <RoomHeaderLeading
                soloAgentParticipant={vm.soloAgentParticipant}
                headerAgent={vm.headerAgent}
                conversationType={conversationType}
                otherCount={vm.otherParticipants.length}
                surfacePlatform={transcript.surfacePlatform}
              />
            )}
            actions={guided ? guided.headerActions : (
              <RoomHeaderActions
                vm={vm}
                roster={roster}
                collab={collab}
                roomActions={roomActions}
                showcase={showcase}
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
                <GuidedPendingMessage pending={pendingMessage} messages={vm.mainMessages} />
                {guided?.footer}
              </>}
              hideScrollbar={Boolean(guided)}
              guided={Boolean(guided)}
            />
            {guided && !guided.composer ? null : transcript.surfacePlatform ? (
              <SurfaceReadOnlyComposer surfacePlatform={transcript.surfacePlatform} />
            ) : (
              <RoomComposer
                guided={guided?.composer ?? undefined}
                composer={composer}
                title={vm.title}
                mentionCategories={vm.mentionCategories}
                agentCommands={vm.agentCommands}
                capabilities={capabilities}
                participantsHaveAgent={roster.participants.some((participant) => participant.principalType === 'agent')}
                memoryEnabled={room.memoryEnabled}
                setMemoryEnabled={room.setMemoryEnabled}
                setMentions={room.setMentions}
                onOpenAttachmentPreview={panels.openAttachmentPreview}
                onOpenFilePreview={panels.openFilePreview}
              />
            )}
          </AppScreenBody>
          {bodyOverlay ? (
            <div className="absolute inset-0 z-30 min-h-0 bg-(--background)">
              {bodyOverlay}
            </div>
          ) : null}
        </div>
      </AppScreenShell>

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
        showcase={showcase}
        currentParticipant={vm.currentParticipant}
        participants={roster.participants}
        router={router}
        onParticipantsAdded={() => {
          room.setAddPeopleOpen(false)
          void roster.loadParticipants()
        }}
      />
    </QuestionnaireComposerProvider>
  );
}
