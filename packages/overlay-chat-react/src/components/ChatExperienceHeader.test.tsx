import assert from 'node:assert/strict'
import test from 'node:test'
import React, { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatExperienceHeader, ChatModelPickerDropdown } from './ChatExperienceHeader'
import type { ChatExperienceHeaderProps } from './ChatExperienceHeader'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('a locked text model picker keeps the generation toggle visible and disabled on Text', () => {
  const html = renderToStaticMarkup(
    <ChatModelPickerDropdown
      favoriteScope="test-user"
      modelRecommendations={{}}
      generationMode="text"
      lockedGenerationMode="text"
      onGenerationModeChange={() => {}}
      isActiveLoading={false}
      modelPickerListScrollRef={createRef<HTMLDivElement>()}
      modelSearchInputRef={createRef<HTMLInputElement>()}
      textModelsLoading={false}
      isFreeTier
      imageModels={[]}
      selectedImageModels={[]}
      onSelectImageModel={() => {}}
      videoModels={[]}
      selectedVideoModels={[]}
      onSelectVideoModel={() => {}}
      selectableTextModels={[]}
      selectedActModel="openrouter/free"
      onToggleTextModel={() => {}}
      isFreeTierChatModelId={() => false}
      onHoveredModelChange={() => {}}
    />,
  )

  assert.match(html, /aria-label="Generation type"/)
  assert.match(html, /aria-selected="true"[^>]*disabled=""/)
  assert.match(html, />Text<\/span>/)
})

test('the chat header keeps existing controls without a Chat/Work selector', () => {
  const html = renderToStaticMarkup(
    <ChatExperienceHeader
      {...({
        activeChatId: null,
        editingChatId: null,
        editingChatTitle: '',
        onEditingChatTitleChange: () => {},
        onCommitChatRename: () => {},
        onCancelChatRename: () => {},
        headerTitleInputRef: createRef<HTMLInputElement>(),
        showAutomationHeaderControls: false,
        titleLabel: 'Chat',
        showRenameButton: false,
        showAutomationChatTab: true,
        appMode: 'chat',
        isTemporaryChat: false,
        isActiveLoading: false,
        onTemporaryChatToggle: () => {},
        onGenerationModeChange: () => {},
        generationMode: 'text',
        modelControlsInComposer: true,
        renderExportMenu: () => null,
      } as ChatExperienceHeaderProps)}
    />,
  )

  assert.match(html, /aria-label="Enable temporary chat"/)
  assert.doesNotMatch(html, /Personal chat mode|Work mode/)
})
