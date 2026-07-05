'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import {
  AttachmentPreviewDialog,
  ChatExperienceHeader,
} from '@overlay/chat-react'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'
import type { AutomationDetail } from '@overlay/app-core'
import { ChatComposer } from './ChatComposer'
import { ChatMessageList } from './ChatMessageList'
import { ChatDropOverlay } from './ChatDropOverlay'

const DraftReviewModal = dynamic(
  () => import('./chat-interface/Modals').then((mod) => ({ default: mod.DraftReviewModal })),
  { loading: () => null },
)
const AutomationEditorPanel = dynamic(
  () => import('./chat-interface/AutomationEditor').then((mod) => ({ default: mod.AutomationEditorPanel })),
  { loading: () => null },
)

type DragHandlers = Pick<
  React.HTMLAttributes<HTMLDivElement>,
  'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'
>

type AutomationEditorProps = {
  automation: AutomationDetail
  onSaved: (automation: AutomationDetail) => void
  onTested: (conversationId: string) => void
  isFreeTier: boolean
}

export type ChatExperienceViewProps = {
  shell: {
    rightPanel: React.ReactNode
    rightPanelOpen: boolean
    rightPanelWidth?: number
    onRightPanelClose?: () => void
  }
  main: {
    activeChatDeleting: boolean
    dragHandlers: DragHandlers
    isDragging: boolean
  }
  headerProps: React.ComponentProps<typeof ChatExperienceHeader>
  body: {
    hasAutomationContext: boolean
    isTemporaryChat: boolean
    selectedAutomationLoading: boolean
    showAutomationChatTab: boolean
  }
  automationEditorProps: AutomationEditorProps | null
  messageListProps: React.ComponentProps<typeof ChatMessageList> | null
  composerProps: React.ComponentProps<typeof ChatComposer> | null
  draftReviewProps: React.ComponentProps<typeof DraftReviewModal>
  attachmentPreviewProps: React.ComponentProps<typeof AttachmentPreviewDialog>
}

export function ChatExperienceView({
  shell,
  main,
  headerProps,
  body,
  automationEditorProps,
  messageListProps,
  composerProps,
  draftReviewProps,
  attachmentPreviewProps,
}: ChatExperienceViewProps) {
  return (
    <>
      <AppScreenShell
        className="min-w-0 overflow-x-hidden"
        contentClassName="flex min-h-0"
        rightPanel={shell.rightPanel}
        rightPanelOpen={shell.rightPanelOpen}
        rightPanelWidth={shell.rightPanelWidth}
        onRightPanelClose={shell.onRightPanelClose}
      >
        <div
          className={`relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden transition-opacity duration-200 ${
            main.activeChatDeleting ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
          {...main.dragHandlers}
        >
          {main.isDragging && <ChatDropOverlay />}
          <ChatExperienceHeader {...headerProps} />

          <AppScreenBody
            padding="none"
            maxWidth="none"
            scroll="hidden"
            className={`flex min-h-0 flex-1 flex-col transition-[background-color,background-image] duration-300 ${
              body.isTemporaryChat ? 'temporary-chat-body-pattern' : ''
            }`}
          >
            {body.hasAutomationContext &&
              !body.selectedAutomationLoading &&
              !automationEditorProps &&
              !body.showAutomationChatTab && (
                <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6">
                  <p className="text-sm text-[var(--muted)]">Automation not found.</p>
                </div>
              )}

            {!body.showAutomationChatTab && automationEditorProps && (
              <AutomationEditorPanel {...automationEditorProps} />
            )}

            {messageListProps && <ChatMessageList {...messageListProps} />}
            {composerProps && <ChatComposer {...composerProps} />}
          </AppScreenBody>

          <DraftReviewModal {...draftReviewProps} />
        </div>
      </AppScreenShell>

      <AttachmentPreviewDialog {...attachmentPreviewProps} />
    </>
  )
}
