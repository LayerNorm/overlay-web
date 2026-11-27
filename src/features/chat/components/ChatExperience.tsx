"use client";

import { RunPlanContext } from './chat/run-plan-context';
import React, { useCallback } from 'react'
import dynamic from 'next/dynamic'
import { buildSharePageUrl } from '@/features/share/lib/share-url'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { ChatExperienceView, type ChatExperienceViewProps } from './ChatExperienceView'
import { QuestionnaireComposerProvider } from '@overlay/chat-react/questionnaire'
import { LinkOpenInterceptor } from './LinkOpenInterceptor'
import { RightSidebarToggle } from '@overlay/modules-react/shell'
import { DirectMessageExperience } from './DirectMessageExperience'
import { useNewAutomationComposer } from '@/features/automations/components/AutomationComposerPickers'
import {
  AUTOMATION_PANEL_WIDTH,
  AutomationDetailsPanel,
  useAutomationPanelOpen,
} from '@/features/automations/components/AutomationDetailsPanel'
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
  () =>
    import("@overlay/modules-react/knowledge").then((mod) => ({
      default: mod.FileViewerPanel,
    })),
  { loading: () => null },
);
const ExportMenu = dynamic(
  () =>
    import("@/features/files/components/ExportMenu").then((mod) => ({
      default: mod.ExportMenu,
    })),
  { loading: () => null },
)

export default function ChatExperience(props: ChatExperienceProps) {
  const c = useChatExperienceController(props)
  const newAutomation = useNewAutomationComposer({
    enabled: c.mode === 'automate' && !c.hasAutomationContext && !c.isTemporaryChat,
    modelId: c.headerModelProps.selectedActModel,
    textareaRef: c.textareaRef,
    onInputChange: c.handleComposerInputChange,
    attachmentCount: c.attachedImages.length + c.pendingChatDocuments.length,
  })
  const [automationPanelOpen, setAutomationPanelOpen] = useAutomationPanelOpen()

  const renderExportMenu = useCallback(() => {
    if (c.selectedAutomation) {
      return <RightSidebarToggle open={automationPanelOpen} onToggle={() => setAutomationPanelOpen((open) => !open)} />
    }
    if (c.primaryMessages.length === 0 || (!c.activeChatId && !c.isTemporaryChat)) {
      return null
    }
    return (
      <ExportMenu
        className="shrink-0"
        type="chat"
        title={c.isTemporaryChat ? 'Temporary chat' : c.activeChatTitle || c.activeChat?.title || 'New conversation'}
        content={c.primaryMessages.map((m) => ({
          role: m.role,
          content:
            (m.parts as Array<{ type: string; text?: string }>)
              ?.filter((p) => p.type === "text")
              .map((p) => p.text ?? "")
              .join("\n") ?? "",
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
    );
  }, [
    c.activeChat,
    c.activeChatId,
    c.activeChatTitle,
    c.isTemporaryChat,
    c.primaryMessages,
    c.selectedAutomation,
    automationPanelOpen,
    setAutomationPanelOpen,
  ])

  const renderAttachmentViewer = useCallback(
    ({
      preview,
      headerRight,
    }: {
      preview: AttachmentPreview;
      headerRight: React.ReactNode;
    }) => (
      <FileViewerPanel
        fileId={preview.fileId}
        name={preview.name}
        content={preview.content}
        url={preview.url}
        headerRight={headerRight}
      />
    ),
    [],
  );

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
  });

  const viewProps: ChatExperienceViewProps = buildChatExperienceViewProps(
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
  )
  const closeAutomationPanel = () => setAutomationPanelOpen(false)
  const automationModelId = c.automationHeaderModelId
  const automationPanel = c.selectedAutomation && automationPanelOpen ? (
    <AutomationDetailsPanel
      automation={c.selectedAutomation}
      onClose={closeAutomationPanel}
      model={{
        models: c.pickerTextModels,
        modelId: automationModelId,
        modelLabel: c.headerModelProps.getChatModelDisplayName(automationModelId),
        onModelChange: (modelId) => void c.saveAutomationHeaderModel(modelId),
        favoriteScope: c.favoriteScope,
        textModelsLoading: c.headerModelProps.textModelsLoading,
        isTextModelLocked: c.isTextModelLocked,
        onLockedTextModelSelect: c.setUpgradeModel,
      }}
    />
  ) : null
  // An agent automation's thread is that agent's thread, so it opens in the agent thread view.
  const agentThreadId = c.selectedAutomation?.agentId ? c.selectedAutomation.conversationId : undefined
  if (agentThreadId) {
    return (
      <DirectMessageExperience
        key={agentThreadId}
        conversationId={agentThreadId}
        headerActions={renderExportMenu()}
        externalRightPanel={automationPanel}
        externalRightPanelLabel="Automation details"
        externalRightPanelMode="docked"
        externalRightPanelWidth={AUTOMATION_PANEL_WIDTH}
        onExternalRightPanelClose={closeAutomationPanel}
      />
    )
  }
  if (automationPanel) {
    viewProps.shell = {
      rightPanel: automationPanel,
      rightPanelOpen: true,
      rightPanelWidth: AUTOMATION_PANEL_WIDTH,
      rightPanelMode: 'docked',
      onRightPanelClose: closeAutomationPanel,
    }
  }
  if (newAutomation && viewProps.composerProps) {
    const composerProps = viewProps.composerProps
    viewProps.composerProps = {
      ...composerProps,
      surface: { ...composerProps.surface, placeholder: newAutomation.placeholder, composerControls: newAutomation.composerControls },
      actions: { ...composerProps.actions, onSend: newAutomation.onSend },
    }
  }

  return (
    <>
      {c.agentRunLifecycle.convexQueryBridge}
      <LinkOpenInterceptor
        preference={c.settings.linkOpenPreference}
        onOpenInOverlay={c.openLinkPreview}
        onOpenFile={(fileId, name) => { void c.openFilePreview(name, [fileId]) }}
      />
      <QuestionnaireComposerProvider value={c.input} readDraft={() => c.inputRef.current} subscribe={c.subscribeToInput} onChange={c.setQuestionnaireDraft} disabled={c.isActiveLoading || c.nativeThreadSafety.readOnly}>
      <RunPlanContext.Provider value={c.agentRunLifecycle.run}>
      <ChatExperienceView
        {...viewProps}
        readOnlyFooter={props.readOnlyFooter}
      />
      </RunPlanContext.Provider>
      </QuestionnaireComposerProvider>
    </>
  );
}
