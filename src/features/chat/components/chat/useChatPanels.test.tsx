import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useLayoutEffect } from 'react'
import type { ReactTestRenderer } from 'react-test-renderer'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useChatPanels } from './useChatPanels'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): ReactTestRenderer
}

type Panels = ReturnType<typeof useChatPanels>

function mountPanels() {
  const panelRef: { current: Panels | null } = { current: null }
  const panels = new Proxy({} as Panels, {
    get(_target, property) {
      const value = panelRef.current
      const member = value?.[property as keyof Panels]
      return typeof member === 'function' ? member.bind(value) : member
    },
  })
  function Probe() {
    const value = useChatPanels()
    useLayoutEffect(() => { panelRef.current = value }, [value])
    const preview = value.attachmentPreview
    return <div
      data-file-id={preview?.fileId ?? ''}
      data-content={preview?.content ?? ''}
      data-loading={String(Boolean(preview?.loading))}
      data-error={preview?.error ?? ''}
      data-url={preview?.url ?? ''}
      data-mode={value.attachmentPreviewMode}
    />
  }
  return { Probe, panels }
}

function installWindow(t: { after(callback: () => void): void }, savedMode = 'panel') {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const writes: string[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://app.getoverlay.io' }, localStorage: {
      getItem: () => savedMode,
      setItem: (_key: string, value: string) => writes.push(value),
    } },
  })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  return writes
}

async function flushPromises() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

test('file previews fetch text by MIME, guard stale responses, and restore the saved presentation mode', async (t) => {
  const writes = installWindow(t, 'dialog')
  const oldResponse = deferred<Response>()
  const newResponse = deferred<Response>()
  const requests: string[] = []
  t.mock.method(overlayAppClient.files, 'contentResponse', (fileId: string) => {
    requests.push(fileId)
    return fileId === 'old-note' ? oldResponse.promise : newResponse.promise
  })
  const { Probe, panels } = mountPanels()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<Probe />) })
  const state = () => renderer.root.findByType('div').props as Record<string, string>
  try {
    assert.equal(panels.attachmentPreviewMode, 'dialog')
    await act(async () => {
      panels.openFilePreview('Old title without extension', ['old-note'], { mimeType: 'text/markdown; charset=utf-8', mode: 'panel' })
    })
    await act(async () => {
      panels.openFilePreview('Current title without extension', ['current-note'], { mimeType: 'text/markdown', mode: 'panel' })
    })
    assert.equal(state()['data-loading'], 'true')
    assert.deepEqual(requests, ['old-note', 'current-note'])
    assert.deepEqual(writes, [], 'forcing panel mode does not overwrite the floating preference')

    await act(async () => {
      newResponse.resolve(new Response('# Current notes'))
      await flushPromises()
    })
    assert.equal(state()['data-file-id'], 'current-note')
    assert.equal(state()['data-content'], '# Current notes')

    await act(async () => {
      oldResponse.resolve(new Response('# Stale notes'))
      await flushPromises()
    })
    assert.equal(state()['data-file-id'], 'current-note')
    assert.equal(state()['data-content'], '# Current notes', 'a stale response cannot replace the current preview')

    await act(async () => { panels.closeAttachmentPreview() })
    assert.equal(panels.attachmentPreviewMode, 'dialog')
    assert.deepEqual(writes, [])
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('permission errors remain visible and retry refreshes the authorized content route', async (t) => {
  installWindow(t)
  let attempts = 0
  const requested: string[] = []
  t.mock.method(overlayAppClient.files, 'contentResponse', (fileId: string) => {
    requested.push(fileId)
    attempts += 1
    return Promise.resolve(attempts === 1
      ? new Response('forbidden', { status: 403 })
      : new Response('# Retried notes'))
  })
  const { Probe, panels } = mountPanels()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<Probe />) })
  const state = () => renderer.root.findByType('div').props as Record<string, string>
  try {
    await act(async () => {
      panels.openFilePreview('Access policy', ['private-note'], { mimeType: 'text/markdown', mode: 'panel' })
      await flushPromises()
    })
    assert.match(state()['data-error'] ?? '', /permission/i)
    await act(async () => {
      panels.attachmentPreview?.onRetry?.()
      await flushPromises()
    })
    assert.equal(state()['data-error'], '')
    assert.equal(state()['data-content'], '# Retried notes')
    assert.deepEqual(requested, ['private-note', 'private-note'])
    assert.equal(state()['data-url'], '/api/v1/files/private-note/content')
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('missing persisted text files show the deleted or missing state', async (t) => {
  installWindow(t)
  t.mock.method(overlayAppClient.files, 'contentResponse', () => Promise.resolve(new Response('missing', { status: 404 })))
  const { Probe, panels } = mountPanels()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<Probe />) })
  const state = () => renderer.root.findByType('div').props as Record<string, string>
  try {
    await act(async () => {
      panels.openFilePreview('Deleted notes', ['deleted-note'], { mimeType: 'text/markdown', mode: 'panel' })
      await flushPromises()
    })
    assert.match(state()['data-error'] ?? '', /missing or was deleted/i)
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('media error and retry use request identity and a refreshed canonical URL', async (t) => {
  installWindow(t)
  const { Probe, panels } = mountPanels()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<Probe />) })
  const state = () => renderer.root.findByType('div').props as Record<string, string>
  try {
    await act(async () => {
      panels.openFilePreview('End card.png', ['image-1'], { mimeType: 'image/png', mode: 'panel' })
    })
    const staleMediaError = panels.attachmentPreview?.onMediaError
    await act(async () => {
      panels.openFilePreview('New image.png', ['image-2'], { mimeType: 'image/png', mode: 'panel' })
    })
    await act(async () => { staleMediaError?.() })
    assert.equal(state()['data-file-id'], 'image-2')
    assert.equal(state()['data-error'], '', 'an error from an older media request is ignored')

    await act(async () => { panels.attachmentPreview?.onMediaError?.() })
    assert.match(state()['data-error'] ?? '', /unavailable/i)
    assert.match(state()['data-url'] ?? '', /^\/api\/v1\/files\/image-2\/content\?previewAttempt=/)
    await act(async () => { panels.attachmentPreview?.onRetry?.() })
    assert.equal(state()['data-error'], '')
    assert.match(state()['data-url'] ?? '', /previewAttempt=\d+/)
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('opening a link or sources panel invalidates an in-flight file preview', async (t) => {
  installWindow(t)
  const response = deferred<Response>()
  t.mock.method(overlayAppClient.files, 'contentResponse', () => response.promise)
  const { Probe, panels } = mountPanels()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<Probe />) })
  const state = () => renderer.root.findByType('div').props as Record<string, string>
  try {
    await act(async () => {
      panels.openFilePreview('Launch notes', ['old-note'], { mimeType: 'text/markdown', mode: 'panel' })
    })
    await act(async () => { panels.openLinkPreview('https://example.test', 'External link') })
    await act(async () => {
      response.resolve(new Response('# Stale notes'))
      await flushPromises()
    })
    assert.equal(state()['data-file-id'], '')
    assert.equal(panels.linkPreview?.url, 'https://example.test')

    await act(async () => {
      panels.openFilePreview('Another note', ['another-note'], { mimeType: 'text/markdown', mode: 'panel' })
    })
    await act(async () => { panels.openSourcesPanel('turn-1', []) })
    assert.equal(state()['data-file-id'], '')
    assert.equal(state()['data-loading'], 'false')
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('opening a non-file attachment invalidates an in-flight text preview', async (t) => {
  installWindow(t)
  const response = deferred<Response>()
  t.mock.method(overlayAppClient.files, 'contentResponse', () => response.promise)
  const { Probe, panels } = mountPanels()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<Probe />) })
  const state = () => renderer.root.findByType('div').props as Record<string, string>
  try {
    await act(async () => {
      panels.openFilePreview('Launch notes', ['old-note'], { mimeType: 'text/markdown', mode: 'panel' })
    })
    await act(async () => {
      panels.openAttachmentPreview({
        name: 'External document', content: '', url: 'https://example.test/document',
      }, { mode: 'panel' })
    })
    await act(async () => {
      response.resolve(new Response('# Stale notes'))
      await flushPromises()
    })
    assert.equal(state()['data-file-id'], '')
    assert.equal(state()['data-content'], '')
    assert.equal(state()['data-url'], 'https://example.test/document')
  } finally {
    await act(async () => { renderer.unmount() })
  }
})
