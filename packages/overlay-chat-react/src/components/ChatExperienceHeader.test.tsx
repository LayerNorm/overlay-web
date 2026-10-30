import assert from 'node:assert/strict'
import test from 'node:test'
import React, { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatModelPickerDropdown } from './ChatExperienceHeader'

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
