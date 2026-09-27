'use client'

import type React from 'react'
import {
  ChevronDown,
} from 'lucide-react'
import { DelayedTooltip } from '../DelayedTooltip'
import { PersonalMentionConversionPrompt } from '../PersonalMentionConversionPrompt'
import type { useChatExperienceController } from './useChatExperienceController'
import type { useChatShellPanels } from './useChatShellPanels'
import type { AttachmentPreview } from './useChatPanels'

type Controller = ReturnType<typeof useChatExperienceController>
type ShellPanels = ReturnType<typeof useChatShellPanels>

export function buildChatExperienceViewProps(
  c: Controller,
  renderExportMenu: () => React.ReactNode,
  renderAttachmentViewer: (args: { preview: AttachmentPreview; headerRight: React.ReactNode }) => React.ReactNode,
  shell: ShellPanels,
) {
  const viewProps = {
    shell: {
      rightPanel: shell.shellRightPanel,
      rightPanelOpen: Boolean(shell.shellRightPanel),
      rightPanelWidth: shell.shellRightPanelWidth,
      rightPanelMode: shell.shellRightPanelMode,
      onRightPanelClose: shell.shellRightPanelClose,
      onRightPanelResize: shell.shellRightPanelResize,
    },
    main: {
      activeChatDeleting: c.activeChatDeleting,
      isDragging: c.isDragging,
      dragHandlers: {
        onDragEnter: (e: React.DragEvent) => {
          e.preventDefault()
          c.dragCounterRef.current++
          if (e.dataTransfer.types.includes('Files')) c.setIsDragging(true)
        },
        onDragOver: (e: React.DragEvent) => e.preventDefault(),
        onDragLeave: () => {
          c.dragCounterRef.current--
          if (c.dragCounterRef.current === 0) c.setIsDragging(false)
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault()
          c.dragCounterRef.current = 0
          c.setIsDragging(false)
          const all = Array.from(e.dataTransfer.files)
          const images = all.filter((f) => f.type.startsWith('image/'))
          if (images.length > 0) c.addImages(images)
          const docExts =
            /^(pdf|docx|txt|md|markdown|csv|json|html|htm|xml|log|ts|tsx|js|jsx|css|yaml|yml|toml|py|go|rs)$/i
          const docs = all.filter((f) => {
            const ext = f.name.split('.').pop() ?? ''
            return (
              docExts.test(ext) ||
              f.type === 'application/pdf' ||
              f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
              (f.type.startsWith('text/') && ext !== '')
            )
          })
          if (docs.length > 0) docs.forEach((f) => c.queueDocumentUpload(f))
        },
      },
    },
    headerProps: {
      hideHeader: c.hideHeader,
      activeChatId: c.activeChatId,
      editingChatId: c.editingChatId,
      editingChatTitle: c.editingChatTitle,
      onEditingChatTitleChange: c.setEditingChatTitle,
      onCommitChatRename: c.commitChatRename,
      onCancelChatRename: c.cancelChatRename,
      headerTitleInputRef: c.headerTitleInputRef,
      showAutomationHeaderControls: c.showAutomationHeaderControls,
      titleLabel: c.headerTitleLabel,
      onBeginHeaderChatRename: c.beginHeaderChatRename,
      showRenameButton: Boolean(c.activeChatId && !c.selectedAutomation && !c.isPublicShowcase),
      projectName: c.projectName,
      showAutomationChatTab: c.showAutomationChatTab,
      appMode: c.mode,
      isTemporaryChat: c.isTemporaryChat,
      isActiveLoading: c.isActiveLoading,
      onTemporaryChatToggle: c.handleTemporaryChatToggle,
      onGenerationModeChange: c.handleGenerationModeChange,
      generationMode: c.generationMode,
      personalChatMode: c.personalChatMode,
      onPersonalChatModeChange: c.handlePersonalChatModeChange,
      renderExportMenu,
      ...c.headerModelProps,
      automationHeaderModelId: c.automationHeaderModelId,
      automationHeaderModels: c.automationHeaderModels,
      onSaveAutomationHeaderModel: c.saveAutomationHeaderModel,
      automationDetailTab: c.automationDetailTab,
      onSelectAutomationDetailTab: c.selectAutomationDetailTab,
    },
    body: {
      hasAutomationContext: c.hasAutomationContext,
      isTemporaryChat: c.isTemporaryChat,
      selectedAutomationLoading: c.selectedAutomationLoading,
      showAutomationChatTab: c.showAutomationChatTab,
    },
    automationEditorProps:
      !c.showAutomationChatTab && c.selectedAutomation && c.automationDetailTab === 'edit'
        ? {
            automation: c.selectedAutomation,
            onSaved: c.setSelectedAutomation,
            onTested: (conversationId: string) => {
              const params = new URLSearchParams(c.searchParams?.toString() ?? '')
              params.set('id', conversationId)
              params.set('automationId', c.selectedAutomation!._id)
              params.delete('tab')
              c.router.replace(`${c.pathname}?${params.toString()}`)
            },
            isFreeTier: c.isFreeTier,
          }
        : null,
    messageListProps:
      c.showAutomationChatTab && (c.hasHistory || c.showChatLoadingState)
        ? {
            messagesScrollRef: c.messagesScrollRef,
            messagesEndRef: c.messagesEndRef,
            floatingControl: c.showScrollToBottomControl ? (
              <DelayedTooltip label="Jump to latest" side="top">
                <button
                  type="button"
                  aria-label="Jump to latest message"
                  onClick={() => c.scrollToConversationBottom('smooth')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] shadow-sm transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                >
                  <ChevronDown size={17} strokeWidth={1.9} />
                </button>
              </DelayedTooltip>
            ) : null,
            showLoadingState: c.showChatLoadingState,
            reserveLatestExchangeStartSpace: c.reserveLatestExchangeStartSpace,
            transcriptKey: c.activeChatId ?? (c.isTemporaryChat ? 'temporary-chat' : null),
            afterMessages: c.usageExhaustedNotice,
            state: {
              primaryMessages: c.primaryMessages,
              latestExchangeIndex: c.latestExchIdx,
              generationResults: c.generationResults,
              exchangeGenTypes: c.exchangeGenTypes,
              exchangeModels: c.exchangeModels,
              selectedImageModels: c.selectedImageModels,
              selectedVideoModels: c.selectedVideoModels,
              selectedTabPerExchange: c.selectedTabPerExchange,
              selectedModels: c.selectedModels,
              exchangeModes: c.exchangeModes,
            },
            runtime: {
              actChat: c.actChat,
              chatInstances: c.chatInstances,
              isActiveLoading: c.isActiveLoading,
              isOptimisticLoading: c.isOptimisticLoading,
              interruptedExchangeIdx: c.interruptedExchangeIdx,
              exitingTurnIds: c.exitingTurnIds,
              sourcesPanel: c.sourcesPanel,
              getResponseForExchangeForModel: c.getResponseForExchangeForModel,
            },
            actions: {
              onTabSelect: c.handleTabSelect,
              onJumpToReply: c.jumpToReplyTarget,
              onDeleteTurn: c.isPublicShowcase ? () => c.requireAuth('history') : c.handleDeleteTurnById,
              onReplyToMediaPrompt: c.beginReplyToMediaPrompt,
              onReplyToAssistantText: c.beginReplyToAssistantText,
              onBranch: c.isPublicShowcase ? () => c.requireAuth('history') : c.handleBranchConversationAtTurn,
              onOpenDraft: c.setDraftModalState,
              onCreateAutomationDraft: c.isPublicShowcase ? () => c.requireAuth('nav') : c.handleCreateAutomationDraftViaChat,
              onOpenSources: c.openSourcesPanel,
              onRetry: c.isPublicShowcase ? () => c.requireAuth('history') : c.handleRetryExchange,
              onOpenFilePreview: c.openFilePreview,
              onOpenAttachmentPreview: c.openAttachmentPreview,
              onContinue: c.handleContinue,
              onGeneratedUiChange: c.isPublicShowcase ? () => c.requireAuth('nav') : c.handleGeneratedUiChange,
              generatedUiConnectorActions: c.generatedUiConnectorActions,
            },
          }
        : null,
    composerProps:
      c.showAutomationChatTab
        ? {
            mode: c.composerMode,
            emptyState: {
              showCenteredEmptyChat: c.showCenteredEmptyChat,
              greetingLine: c.greetingLine,
              belowEmptyComposer: c.emptyComposerContent,
            },
            attachments: {
              attachedImages: c.attachedImages,
              setAttachedImages: c.setAttachedImages,
              pendingChatDocuments: c.pendingChatDocuments,
              removePendingDocument: c.removePendingDocument,
              attachmentError: c.attachmentError,
              fileInputRef: c.fileInputRef,
              docInputRef: c.docInputRef,
              onAddImages: c.addImages,
              onAddDocumentsFromPicker: c.addDocumentsFromPicker,
              onOpenAttachmentPreview: c.openAttachmentPreview,
              onOpenFilePreview: c.openFilePreview,
            },
            runtime: {
              composerNotice: c.composerNotice,
              beforeComposerContent: c.personalMentionConfirmationOpen && c.activeWorkspaceId ? (
                <PersonalMentionConversionPrompt
                  draft={c.inputRef.current ?? c.input}
                  mentions={c.personMentions}
                  sourceConversationId={c.activeChatId}
                  workspaceId={c.activeWorkspaceId}
                  onCancel={() => c.setPersonalMentionConfirmationOpen(false)}
                />
              ) : c.workApprovalContent,
              billingPromptContent: c.hasHistory ? null : c.usageExhaustedNotice,
              isSendBlocked: c.isSendBlocked,
              isActiveLoading: c.isActiveLoading,
              isTemporaryChat: c.isTemporaryChat,
              blockedComposerContent: c.isBudgetExhaustedPaid ? null : (
                <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-xs text-[var(--muted)]">
                  This model requires a paid plan. Switch to Auto or upgrade.
                </div>
              ),
            },
            inputState: {
              replyContext: c.replyContext,
              setReplyContext: c.setReplyContext,
              textareaRef: c.textareaRef,
              input: c.input,
              inputRevision: c.inputRevision,
              onInputChange: c.handleComposerInputChange,
              onMentionsChange: c.handleMentionsChange,
              onPaste: c.handlePaste,
              hasComposerText: c.hasComposerText,
            },
            toolState: {
              showAttachMenu: c.showAttachMenu,
              setShowAttachMenu: c.setShowAttachMenu,
              attachMenuRef: c.attachMenuRef,
              selectedToolIds: c.selectedToolIds,
              memoryEnabled: c.memoryEnabled,
              capabilities: c.capabilities,
              onToggleTool: c.toggleComposerTool,
              onToggleMemory: () => c.setMemoryEnabled((current) => !current),
              onRemoveTool: c.removeComposerTool,
            },
            modeState: {
              onModeChange: c.handleGenerationModeChange,
              generationChip: c.generationChip,
              setGenerationChip: c.handleGenerationChipChange,
              showModeMenu: c.showModeMenu,
              setShowModeMenu: c.setShowModeMenu,
              modeMenuRef: c.modeMenuRef,
              onNavigateMode: (nextMode: 'chat' | 'automate') => {
                c.router.push(nextMode === 'chat' ? '/app/chat' : '/app/automations')
                c.setShowModeMenu(false)
              },
            },
            surface: {
              mentionCategories: c.mentionCategories,
            },
            actions: {
              onStop: c.stopActiveChat,
              onSend: c.effectiveHandleSend,
              onEmptySuggestion: c.handleEmptySuggestion,
              onAutomateSuggestion: c.handleAutomateSuggestion,
            },
          }
        : null,
    draftReviewProps: {
      state: c.draftModalState,
      saving: c.isDraftSaving,
      onClose: () => {
        if (!c.isDraftSaving) c.setDraftModalState(null)
      },
      onSaveSkill: c.saveSkillDraft,
      onSaveAutomation: c.handleCreateAutomationDraftViaChat,
    },
    attachmentPreviewProps: {
      open: Boolean(c.attachmentPreview && c.attachmentPreviewMode === 'dialog'),
      preview: c.attachmentPreview,
      onClose: c.closeAttachmentPreview,
      onModeChange: c.setAttachmentPreviewMode,
      renderViewer: renderAttachmentViewer,
    },
  }
  return viewProps
}
