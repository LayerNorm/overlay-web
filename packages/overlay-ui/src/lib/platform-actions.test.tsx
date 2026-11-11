import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test, { after } from 'node:test'
import React, { act, type ReactElement } from 'react'
import { CodeBlockCopyButton } from '../components/ui/code-block'
import { PlatformActionsProvider, usePlatformActions, type PlatformActions } from '../platform-actions'

type TestRenderer = { root: { findAll(predicate: (node: { type: unknown; props: Record<string, unknown> }) => boolean): Array<{ type: unknown; props: Record<string, unknown> }> }; unmount(): void; update(element: ReactElement): void }
const { create } = createRequire(import.meta.url)('react-test-renderer') as { create(element: ReactElement): TestRenderer }
const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
after(() => {
  if (previousActEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

function Capture({ onActions }: { onActions: (actions: PlatformActions) => void }) {
  onActions(usePlatformActions())
  return <span />
}

async function capturedActions() {
  let actions!: PlatformActions
  let renderer!: TestRenderer
  await act(async () => { renderer = create(<Capture onActions={(value) => { actions = value }} />) })
  return { actions, renderer }
}

test('browser defaults copy text, download successfully, and revoke URLs after post-allocation failures', async () => {
  const descriptors = new Map(['navigator', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const calls: unknown[] = []
  const createdUrls: string[] = []
  const revokedUrls: string[] = []
  const downloadedBlobs: Blob[] = []
  let failureAt: 'create' | 'href' | 'download' | 'click' | null = null
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text: string) => calls.push(text) } } })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        calls.push(['create', tag])
        if (failureAt === 'create') throw new Error('create failed')
        return {
          set href(value: string) {
            calls.push(['href', value])
            if (failureAt === 'href') throw new Error('href failed')
          },
          set download(value: string) {
            calls.push(['download', value])
            if (failureAt === 'download') throw new Error('download failed')
          },
          click() {
            calls.push(['click', tag])
            if (failureAt === 'click') throw new Error('click failed')
          },
        }
      },
    },
  })
  URL.createObjectURL = ((blob: Blob) => {
    downloadedBlobs.push(blob)
    const url = `blob:${createdUrls.length + 1}`
    createdUrls.push(url)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = ((url: string) => { revokedUrls.push(url) }) as typeof URL.revokeObjectURL
  try {
    const { actions, renderer } = await capturedActions()
    await actions.copyText('copied')
    await actions.downloadText('file.txt', 'body')
    assert.deepEqual(calls, ['copied', ['create', 'a'], ['href', 'blob:1'], ['download', 'file.txt'], ['click', 'a']])
    assert.equal(downloadedBlobs[0]?.type, 'text/plain;charset=utf-8')
    assert.equal(await downloadedBlobs[0]?.text(), 'body')
    assert.deepEqual(revokedUrls, ['blob:1'])

    failureAt = 'create'
    await assert.rejects(actions.downloadText('create.txt', 'body'), /create failed/)
    failureAt = 'href'
    await assert.rejects(actions.downloadText('href.txt', 'body'), /href failed/)
    failureAt = 'download'
    await assert.rejects(actions.downloadText('download.txt', 'body'), /download failed/)
    failureAt = 'click'
    await assert.rejects(actions.downloadText('click.txt', 'body'), /click failed/)
    assert.deepEqual(createdUrls, ['blob:1', 'blob:2', 'blob:3', 'blob:4', 'blob:5'])
    assert.deepEqual(revokedUrls, createdUrls)
    await act(() => renderer.unmount())
  } finally {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

test('nested providers override one action and inherit the other with stable merged identity', async () => {
  const parentCopy = async () => undefined
  const childDownload = async () => undefined
  const seen: PlatformActions[] = []
  function Reader() { const actions = usePlatformActions(); seen.push(actions); return null }
  const tree = () => <PlatformActionsProvider copyText={parentCopy}><PlatformActionsProvider downloadText={childDownload}><Reader /></PlatformActionsProvider></PlatformActionsProvider>
  let renderer!: TestRenderer
  await act(async () => { renderer = create(tree()) })
  await act(async () => { renderer.update(tree()) })
  assert.equal(seen.at(-1)?.copyText, parentCopy)
  assert.equal(seen.at(-1)?.downloadText, childDownload)
  assert.equal(seen.at(-1), seen.at(-2))
  await act(() => renderer.unmount())
})

test('SSR import and render do not require browser globals', () => {
  const moduleUrl = new URL('../platform-actions.tsx', import.meta.url).href
  const source = `
    delete globalThis.navigator;
    delete globalThis.document;
    const React = await import('react');
    const { renderToString } = await import('react-dom/server');
    const { PlatformActionsProvider, usePlatformActions } = await import(${JSON.stringify(moduleUrl)});
    function Reader() { usePlatformActions(); return React.createElement('span'); }
    if (renderToString(React.createElement(PlatformActionsProvider, null, React.createElement(Reader))) !== '<span></span>') process.exit(1);
  `
  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { cwd: process.cwd() })
})

test('CodeBlockCopyButton uses injected copy and does not flash on rejection or call when disabled', async () => {
  const actions: string[] = []
  let reject = true
  const copyText = async (text: string) => { actions.push(text); if (reject) throw new Error('denied') }
  let renderer!: TestRenderer
  await act(async () => { renderer = create(<PlatformActionsProvider copyText={copyText}><CodeBlockCopyButton value="snippet" /></PlatformActionsProvider>) })
  const button = () => renderer.root.findAll((node) => node.type === 'button')[0]
  await act(async () => { (button().props.onClick as (event: unknown) => void)({}) ; await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert.equal(actions[0], 'snippet')
  assert.equal(button().props['aria-label'], 'Copy')
  reject = false
  await act(async () => { (button().props.onClick as (event: unknown) => void)({}); await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert.equal(button().props['aria-label'], 'Copied')
  await act(async () => { renderer.update(<PlatformActionsProvider copyText={copyText}><CodeBlockCopyButton value="disabled" disabled /></PlatformActionsProvider>) })
  await act(async () => { (button().props.onClick as (event: unknown) => void)({}) })
  assert.equal(actions.length, 2)
  await act(() => renderer.unmount())
})
