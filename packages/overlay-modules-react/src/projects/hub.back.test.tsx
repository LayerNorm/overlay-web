import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectHubHeader } from './hub'

const noop = () => undefined

test('project hub header exposes an accessible back affordance when requested', () => {
  const html = renderToStaticMarkup(
    <ProjectHubHeader
      projectName="Launch plan"
      editingName={false}
      draftName="Launch plan"
      onBack={noop}
      onStartRename={noop}
      onDraftNameChange={noop}
      onCommitRename={noop}
      onCancelRename={noop}
    />,
  )

  assert.match(html, /aria-label="Back to projects"/)
  assert.match(html, /Launch plan/)
})
