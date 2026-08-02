import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectHubModeControl, ProjectHubTabs } from './hub'

const noop = () => undefined

test('project hub exposes the canonical Chat, Files, and Settings modes', () => {
  const html = renderToStaticMarkup(
    <ProjectHubModeControl activeTab="chat" onTabChange={noop} />,
  )

  assert.match(html, /aria-label="Project views"/)
  assert.match(html, />Chat</)
  assert.match(html, />Files</)
  assert.match(html, />Settings</)
  assert.match(html, /aria-selected="true"/)
})

test('project chat mode lists project-scoped conversations', () => {
  const html = renderToStaticMarkup(
    <ProjectHubTabs
      activeTab="chat"
      chats={[{ _id: 'chat-1', title: 'Project planning' }]}
      files={[]}
      instructions=""
      instructionsLoaded
      onOpenChat={noop}
      onOpenFile={noop}
      onInstructionsChange={noop}
    />,
  )

  assert.match(html, /Recent chats/)
  assert.match(html, /Project planning/)
})

test('project files mode describes working materials and exposes file actions', () => {
  const html = renderToStaticMarkup(
    <ProjectHubTabs
      activeTab="files"
      chats={[]}
      files={[{
        _id: 'file-1',
        name: 'Working draft.md',
        type: 'file',
        kind: 'upload',
        parentId: null,
        updatedAt: 1,
      }]}
      instructions=""
      instructionsLoaded
      fileActions={<button type="button">Add material</button>}
      onOpenChat={noop}
      onOpenFile={noop}
      onInstructionsChange={noop}
    />,
  )

  assert.match(html, /Project files/)
  assert.match(html, /Working materials scoped to this project/)
  assert.match(html, /Working draft\.md/)
  assert.match(html, /Add material/)
})

test('project settings keep instructions, attached knowledge, and lifecycle distinct', () => {
  const html = renderToStaticMarkup(
    <ProjectHubTabs
      activeTab="settings"
      chats={[]}
      files={[]}
      instructions="Answer as a concise project analyst."
      instructionsLoaded
      knowledgeBaseSettings={<div>Attached knowledge base</div>}
      lifecycleSettings={<div>Archive or delete project</div>}
      onOpenChat={noop}
      onOpenFile={noop}
      onInstructionsChange={noop}
    />,
  )

  assert.match(html, /Instructions/)
  assert.match(html, /Answer as a concise project analyst/)
  assert.match(html, /Attached knowledge base/)
  assert.match(html, /Archive or delete project/)
})
