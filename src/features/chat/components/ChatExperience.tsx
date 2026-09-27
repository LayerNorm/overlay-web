'use client'

import React, { useCallback } from 'react'
import dynamic from 'next/dynamic'
import { buildSharePageUrl } from '@/features/share/lib/share-url'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { ChatExperienceView } from './ChatExperienceView'
import { LinkOpenInterceptor } from './LinkOpenInterceptor'
import { useChatShellPanels } from './chat/useChatShellPanels'
import type { AttachmentPreview } from './chat/useChatPanels'
import { buildChatExperienceViewProps } from './chat/chatExperienceViewProps'
import {
  useChatExperienceController,
  type ChatExperienceProps,
} from './chat/useChatExperienceController'

// Heavy, conditionally-rendered surfaces are code-split out of the initial chat
// bundle. They only mount on specific interactions (billing top-up, export,
// file/attachment preview, draft review, automation editing).
//
// Each MUST pass a `loading` option: next/dynamic only wraps the lazy component
// in its own <Suspense> boundary when `ssr: false` or `loading` is set
// (otherwise it uses a Fragment). Without a local boundary, the chunk's
// first-load suspension bubbles up to ChatSuspenseBoundary and replaces the
// entire chat with its (headerless) fallback — i.e. the chat appears to reload
// when you open an image or send the first message.
// NB: the options must be an inline object literal — next/dynamic's SWC
// transform rejects a shared/referenced options variable.
const FileViewerPanel = dynamic(
  () => import('@overlay/modules-react/knowledge').then((mod) => ({ default: mod.FileViewerPanel })),
  { loading: () => null },
)
const ExportMenu = dynamic(
  () => import('@/features/files/components/ExportMenu').then((mod) => ({ default: mod.ExportMenu })),
  { loading: () => null },
)

export default function ChatExperience(props: ChatExperienceProps) {
  const c = useChatExperienceController(props)

  const renderExportMenu = useCallback(() => {
    if (c.selectedAutomation || c.primaryMessages.length === 0 || (!c.activeChatId && !c.isTemporaryChat)) {
      return null
    }
    return (
      <ExportMenu
        className="shrink-0"
        type="chat"
        title={c.isTemporaryChat ? 'Temporary chat' : c.activeChatTitle || c.activeChat?.title || 'New conversation'}
        content={c.primaryMessages.map((m) => ({
          role: m.role,
          content: (m.parts as Array<{ type: string; text?: string }>)?.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n') ?? '',
          parts: m.parts as Array<{ type: string; text?: string }>,
        }))}
        metadata={{
          createdAt: c.activeChat?.createdAt,
          updatedAt: c.activeChat?.updatedAt,
          modelIds: c.activeChat?.modelIds,
        }}
        resourceId={c.isTemporaryChat ? undefined : c.activeChatId ?? undefined}
        initialShareVisibility={c.activeChat?.shareVisibility ?? 'private'}
        initialShareUrl={
          !c.isTemporaryChat && c.activeChat?.shareVisibility === 'public' && c.activeChat?.shareToken
            ? buildSharePageUrl('chat', c.activeChat.shareToken)
            : null
        }
        renderShareDialog={(dialogProps) => <ShareDialog {...dialogProps} />}
      />
    )
  }, [
    c.activeChat,
    c.activeChatId,
    c.activeChatTitle,
    c.isTemporaryChat,
    c.primaryMessages,
    c.selectedAutomation,
  ])

  const renderAttachmentViewer = useCallback(
    ({
      preview,
      headerRight,
    }: {
      preview: AttachmentPreview
      headerRight: React.ReactNode
    }) => (
      <FileViewerPanel
        name={preview.name}
        content={preview.content}
        url={preview.url}
        headerRight={headerRight}
      />
    ),
    [],
  )

  const {
    shellRightPanel,
    shellRightPanelClose,
    shellRightPanelMode,
    shellRightPanelOpen,
    shellRightPanelResize,
    shellRightPanelWidth,
  } = useChatShellPanels({
    ...c.shellPanelInputs,
    renderAttachmentViewer,
  })

  return (
    <>
      {c.agentRunLifecycle.convexQueryBridge}
      {c.liveQueryBridge}
      <LinkOpenInterceptor
        preference={c.settings.linkOpenPreference}
        onOpenInOverlay={c.openLinkPreview}
      />
      <ChatExperienceView
        {...buildChatExperienceViewProps(
          c,
          renderExportMenu,
          renderAttachmentViewer,
          {
            shellRightPanel,
            shellRightPanelClose,
            shellRightPanelMode,
            shellRightPanelOpen,
            shellRightPanelResize,
            shellRightPanelWidth,
          },
        )}
      />
    </>
  )
}
