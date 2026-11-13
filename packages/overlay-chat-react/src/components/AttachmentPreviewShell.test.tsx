import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act } from 'react'
import type { ReactTestRenderer } from 'react-test-renderer'
import { AttachmentPreviewPanel } from './AttachmentPreviewShell'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): ReactTestRenderer
}

test('Back to Library closes the shared preview before restoring the Library context', async () => {
  const actions: string[] = []
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      <AttachmentPreviewPanel
        preview={{ name: 'Launch notes', content: '', onBack: () => actions.push('library') }}
        mode="panel"
        onClose={() => actions.push('close')}
        onModeChange={() => undefined}
        renderViewer={({ headerLeft }) => <div>{headerLeft}</div>}
      />,
    )
  })
  const back = renderer.root.findAllByType('button').find((button) => button.children.includes('Back to Library'))
  assert.ok(back)
  try {
    await act(async () => { back.props.onClick() })
    assert.deepEqual(actions, ['close', 'library'])
  } finally {
    await act(async () => { renderer.unmount() })
  }
})
