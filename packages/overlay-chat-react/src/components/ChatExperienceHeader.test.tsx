import assert from 'node:assert/strict'
import test from 'node:test'
import React, { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatExperienceHeader, ChatModelPicker, ChatModelPickerDropdown } from './ChatExperienceHeader'
import type { ChatExperienceHeaderProps } from './ChatExperienceHeader'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('model picker cannot open while workspace access is unresolved', () => {
  for (const modelAccessPending of [true, false]) {
    const html = renderToStaticMarkup(
      <ChatModelPicker
        modelPickerLabel="Selected model"
        modelAccessPending={modelAccessPending}
        showModelPicker
        selectableTextModels={[]}
        selectedActModel="openai/gpt-5"
        onToggleTextModel={() => {}}
      />,
    )
    const trigger = html.match(/<button\b[^>]*>/)?.[0]
    assert.ok(trigger)
    assert.equal(trigger.includes('disabled=""'), modelAccessPending)
    assert.ok(trigger.includes(`aria-expanded="${!modelAccessPending}"`))
  }
})

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
      imageModels={[]}
      selectedImageModels={[]}
      onSelectImageModel={() => {}}
      videoModels={[]}
      selectedVideoModels={[]}
      onSelectVideoModel={() => {}}
      selectableTextModels={[]}
      selectedActModel="openai/gpt-5"
      onToggleTextModel={() => {}}
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
