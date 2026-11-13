/* eslint-disable @typescript-eslint/no-require-imports */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import React from 'react'
import type { Page } from 'playwright'
import { toNativeChatTranscriptView } from '../lib/toNativeChatTranscriptView'
import { createNativeTranscriptDomSnapshot, MAX_NATIVE_TRANSCRIPT_DELIVERY_EPOCH } from '../lib/nativeChatTranscriptProjection'
import type { NativeTranscriptProjectionAsset } from '../lib/nativeChatTranscriptProjection'
import NativeSharedTranscript from '../components/chat/NativeSharedTranscript.dom'
import { knowledgeSourceHref } from '../../packages/overlay-chat-react/src/lib/knowledge-sources'
import { MAX_TRANSCRIPT_TEXT_LENGTH, type NativeTranscriptActionRequest, type NativeTranscriptActionResult } from '../lib/nativeChatTranscriptActions'
import { MAX_AUTOMATION_GRAPH_SOURCE_LENGTH } from '../lib/nativeTranscriptLimits'

const rendererApi = require('../../node_modules/react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>
  create: (element: React.ReactElement) => { root: { findByProps: (props: Record<string, unknown>) => { props: Record<string, (...args: unknown[]) => unknown> & Record<string, unknown>; children: unknown[] }; findAllByProps: (props: Record<string, unknown>) => unknown[] }; update: (element: React.ReactElement) => void; unmount: () => void; toJSON: () => unknown }
}
const { act, create } = rendererApi
const runAct = (callback: () => void | Promise<void>) => act(callback)
const { renderToStaticMarkup } = require('../../node_modules/react-dom/server') as { renderToStaticMarkup: (element: React.ReactElement) => string }
const mobilePackage = require('../package.json') as { devDependencies: { playwright: string } }
const mobilePlaywrightPath = require.resolve('../node_modules/playwright/package.json')
const importedPlaywrightPath = require.resolve('playwright/package.json')
const playwrightPackage = require('playwright/package.json') as { version: string }
if (mobilePlaywrightPath !== importedPlaywrightPath || playwrightPackage.version !== mobilePackage.devDependencies.playwright) {
  throw new Error('The mounted transcript suite must use Mobile’s declared Playwright package.')
}
const { chromium } = require('playwright') as typeof import('playwright')
const esbuildApi = require('../../node_modules/esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
const { buildAutomationDraftFromTurn } = require('../../src/features/automations/lib/automation-drafts.ts') as {
  buildAutomationDraftFromTurn: (input: { userText: string }) => { graphSource: string; [key: string]: unknown }
}

class DomTestElement {
  readonly ancestors: Record<string, unknown> = {}
  readonly attributes: Record<string, string> = {}
  closest(selector: string): unknown { return this.ancestors[selector] ?? null }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null }
}

const scope = { workspaceId: 'workspace-1', conversationId: 'conversation-1', mountNonce: 'mount-1', focusNonce: 'focus-1' }

function makeView() {
  const adapted = toNativeChatTranscriptView([
    { id: 'user-1', turnId: 'turn-1', role: 'user', content: 'User context', timestamp: 10, mode: 'act' },
    {
      id: 'assistant-1', turnId: 'turn-1', role: 'assistant', content: 'Variant A', timestamp: 20,
      modelId: 'openai/gpt-5', selectedModelId: 'openai/gpt-5', status: 'completed',
      responses: [
        { modelId: 'openai/gpt-5', content: 'Variant A', status: 'completed', variantIndex: 0 },
        { modelId: 'anthropic/sonnet', content: 'Variant B search context', status: 'completed', variantIndex: 1 },
      ],
    },
  ] as never)
  return structuredClone(adapted)
}

function makeSourcesView() {
  const view = structuredClone(toNativeChatTranscriptView([
    { id: 'sources-user', turnId: 'sources-turn', role: 'user', content: 'Summarize these sources', timestamp: 10, mode: 'act' },
    { id: 'sources-assistant', turnId: 'sources-turn', role: 'assistant', content: 'Evidence [1] and [2]', timestamp: 20, modelId: 'provider/model', status: 'completed' },
  ] as never))
  const response = view.exchanges[0]!.responses[0]!
  response.sourceCitations = {
    '1': { kind: 'file', sourceId: 'file-resource-1', title: 'Project plan', snippet: 'Plan excerpt' },
    '2': { kind: 'memory', sourceId: 'memory-resource-2', title: 'Saved preference', snippet: 'Memory excerpt' },
  }
  response.sources = [
    { id: 'provider-url-source', sourceKind: 'url', sourceId: 'web-resource-1', url: 'https://public.example/reference', title: 'Public reference', originIndex: 0 },
    { id: 'provider-file-source', sourceKind: 'document', sourceId: 'file-resource-3', filename: 'notes.pdf', title: 'Known provider file', originIndex: 1 },
    { id: 'unavailable-file-source', sourceKind: 'document', sourceId: 'not-registered', filename: 'unknown.pdf', title: 'Unavailable file', originIndex: 2 },
  ] as never
  return view
}

function makeSourcesSnapshot(view = makeSourcesView(), patch: Record<string, unknown> = {}) {
  const exchange = view.exchanges[0]
  return createNativeTranscriptDomSnapshot({
    ...scope,
    theme: 'dark',
    view,
    supportedActions: ['copy', 'reply', 'open-source', 'open-citation'],
    query: '',
    scrollIntent: null,
    assets: exchange ? [
      { handle: 'opaque_asset_handle_000021', exchangeId: exchange.id, resourceId: 'file-resource-3', resourceKind: 'file', previewable: true, label: 'notes.pdf' },
      { handle: 'opaque_citation_handle_000022', exchangeId: exchange.id, resourceId: 'file-resource-1', resourceKind: 'file', previewable: true, label: 'Project plan' },
    ] : [],
    ...patch,
  } as Parameters<typeof createNativeTranscriptDomSnapshot>[0])
}

function snapshot(view = makeView(), patch: Record<string, unknown> = {}) {
  return createNativeTranscriptDomSnapshot({
    ...scope, theme: 'dark', view, supportedActions: ['copy', 'download-text', 'reply', 'open-link', 'open-source', 'keyboard-dismiss'],
    query: '', scrollIntent: null, assets: [], ...patch,
  } as Parameters<typeof createNativeTranscriptDomSnapshot>[0])
}

function makeMediaView(
  outputs: readonly Record<string, unknown>[] = [],
  generationMode: 'image' | 'video' = 'image',
  prompt = 'Generate one media result',
) {
  return structuredClone(toNativeChatTranscriptView([
    {
      id: 'media-user', turnId: 'media-turn', role: 'user', content: prompt, timestamp: 10, mode: 'act',
      contentType: generationMode, outputs: [...outputs],
    },
  ] as never))
}

function makeMediaSnapshot(
  view = makeMediaView(),
  assets: NativeTranscriptProjectionAsset[] = [],
  supportedActions: NativeTranscriptActionRequest['kind'][] = ['copy', 'reply', 'open-asset'],
) {
  return createNativeTranscriptDomSnapshot({
    ...scope, theme: 'dark', view, supportedActions, query: '', scrollIntent: null, assets,
  })
}

function generatedUiBlock(data: unknown, id = 'generated-ui-part') {
  return { kind: 'generated-ui', part: { type: 'data', id, dataType: 'overlay.generated_ui', data } } as never
}

function makeGeneratedUiView(data: unknown, userText = 'Same text') {
  const view = makeView()
  const exchange = view.exchanges[0]!
  const response = exchange.responses[0]!
  exchange.user.text = userText
  response.blocks = [{ kind: 'text', text: userText } as never, generatedUiBlock(data)]
  response.status = 'completed'
  return view
}

function makeGeneratedUiSnapshot(data: unknown, supportedActions: NativeTranscriptActionRequest['kind'][] = ['copy', 'download-text', 'reply']) {
  return snapshot(makeGeneratedUiView(data), { supportedActions })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function nativeTranscriptBrowserBundle(): Promise<string> {
  const parentWebRoot = resolve(process.cwd(), '..')
  const entry = `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import NativeSharedTranscript from '../components/chat/NativeSharedTranscript.dom'
    let root
    window.__nativeTranscriptActions = []
    window.__nativeTranscriptReady = []
    window.__nativeTranscriptPending = false
    window.__mountNativeTranscript = (snapshot) => {
      root = createRoot(document.getElementById('root'))
      root.render(React.createElement(NativeSharedTranscript, {
        snapshot,
        onAction: (request) => {
          window.__nativeTranscriptActions.push(request)
          if (window.__nativeTranscriptPending) return new Promise((resolve) => { window.__resolveNativeTranscriptAction = resolve })
          return Promise.resolve(window.__nativeTranscriptResult || { ok: true })
        },
        onReady: (scope) => { window.__nativeTranscriptReady.push(scope) },
      }))
    }
    window.__updateNativeTranscript = (snapshot) => root.render(React.createElement(NativeSharedTranscript, {
      snapshot,
      onAction: (request) => {
        window.__nativeTranscriptActions.push(request)
        if (window.__nativeTranscriptPending) return new Promise((resolve) => { window.__resolveNativeTranscriptAction = resolve })
        return Promise.resolve(window.__nativeTranscriptResult || { ok: true })
      },
      onReady: (scope) => { window.__nativeTranscriptReady.push(scope) },
    }))
    window.__unmountNativeTranscript = () => root?.unmount()
  `
  const result = await esbuildApi.build({
    absWorkingDir: process.cwd(),
    stdin: { contents: entry, resolveDir: resolve(process.cwd(), 'scripts'), sourcefile: 'native-transcript-browser-entry.tsx', loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    tsconfig: '../tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'pinned-parent-web-dependencies',
      setup: (build: { onResolve: (options: unknown, callback: (args: { path: string }) => unknown) => void; onLoad: (options: unknown, callback: () => unknown) => void }) => {
        build.onResolve({ filter: /^(?:react|react-dom)(?:\/.*)?$/ }, (args) => {
          try { return { path: require.resolve(args.path, { paths: [parentWebRoot] }) } } catch { return }
        })
        build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }))
      },
    }],
  })
  return result.outputFiles[0]?.text ?? ''
}

async function settleSharedUi() {
  await runAct(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function settleInitialTranscriptLayout(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => true))
  await page.waitForFunction(() => {
    const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
    return Boolean(viewport && viewport.getAnimations({ subtree: true }).every((animation) => {
      const endTime = animation.effect?.getComputedTiming().endTime
      return !Number.isFinite(endTime) || animation.playState === 'finished'
    }))
  })
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function prepareOutsidePointerRelease(page: Page, point: { x: number; y: number }) {
  const outsideViewport = await page.evaluate(({ x, y }) => {
    document.querySelector('[data-test-outside-pointer-release]')?.remove()
    const target = document.createElement('div')
    target.dataset.testOutsidePointerRelease = 'true'
    target.style.cssText = `position:fixed;left:${x - 2}px;top:${y - 2}px;width:4px;height:4px;z-index:2147483647`
    document.body.append(target)
    const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
    const hit = document.elementFromPoint(x, y)
    return Boolean(viewport && hit === target && !viewport.contains(hit))
  }, point)
  assert.ok(outsideViewport, 'release target should be outside the transcript viewport')
}

async function removeOutsidePointerRelease(page: Page) {
  await page.locator('[data-test-outside-pointer-release]').evaluate((element) => element.remove())
}

async function observeNextPointerUpOutsideViewport(page: Page) {
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
    ;(window as unknown as { __testPointerUpOutsideViewport: boolean }).__testPointerUpOutsideViewport = false
    document.addEventListener('pointerup', (event) => {
      ;(window as unknown as { __testPointerUpOutsideViewport: boolean }).__testPointerUpOutsideViewport = Boolean(
        viewport && !viewport.contains(event.target as Node),
      )
    }, { capture: true, once: true })
  })
}

function output(id: string, type: 'image' | 'video', status: 'pending' | 'completed' | 'failed', url?: string) {
  return {
    _id: id,
    type,
    status,
    modelId: 'media-model',
    prompt: 'Generate one media result',
    createdAt: 20,
    ...(url ? { url } : {}),
  }
}

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(renderedText).join('')
  if (value && typeof value === 'object') return renderedText((value as { children?: unknown }).children)
  return ''
}

function makeRealDraftView(skillDraft: Record<string, unknown>, automationDraft: Record<string, unknown>) {
  return toNativeChatTranscriptView([
    { id: 'skill-user', turnId: 'skill-turn', role: 'user', content: 'Create a skill for Gmail', timestamp: 10, mode: 'act' },
    {
      id: 'skill-assistant', turnId: 'skill-turn', role: 'assistant', content: 'Skill draft ready', timestamp: 20,
      modelId: 'provider/model', status: 'completed', toolInvocations: [
        { toolCallId: 'skill-tool-key', toolName: 'draft_skill_from_chat', state: 'output-available', toolOutput: { success: true, draft: skillDraft } },
      ],
    },
    { id: 'automation-user', turnId: 'automation-turn', role: 'user', content: 'Create a daily tech news digest email using Gmail', timestamp: 30, mode: 'act' },
    {
      id: 'automation-assistant', turnId: 'automation-turn', role: 'assistant', content: 'Automation draft ready', timestamp: 40,
      modelId: 'provider/model', status: 'completed', toolInvocations: [
        { toolCallId: 'automation-tool-key', toolName: 'draft_automation_from_chat', state: 'output-available', toolOutput: { success: true, draft: automationDraft } },
      ],
    },
  ] as never)
}

function installDomShims() {
  const eventTarget = () => {
    const listeners = new Map<string, Set<(event: Event) => void>>()
    return {
      addEventListener(type: string, listener: (event: Event) => void) {
        const current = listeners.get(type) ?? new Set()
        current.add(listener)
        listeners.set(type, current)
      },
      removeEventListener(type: string, listener: (event: Event) => void) { listeners.get(type)?.delete(listener) },
      dispatchEvent(event: Event) {
        listeners.get(event.type)?.forEach(listener => listener(event))
        return true
      },
    }
  }
  const documentEvents = eventTarget()
  const windowEvents = eventTarget()
  Object.assign(globalThis, {
    Element: DomTestElement,
    document: { ...documentEvents, visibilityState: 'visible', documentElement: { dataset: {} }, fonts: { ready: Promise.resolve() } },
    window: {
      ...windowEvents,
      getComputedStyle: () => ({ lineHeight: '22px' }),
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
      setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
  })
}

function fireLinkClick(viewport: { props: Record<string, (...args: unknown[]) => unknown> }, url: string, align: 'start' | 'end', responseId: string, exchangeId = 'turn-1') {
  const host = { dataset: { nativeExchange: exchangeId, nativeResponseId: responseId } }
  const anchor = new DomTestElement()
  anchor.attributes.href = url
  anchor.ancestors['[data-native-exchange]'] = host
  if (align === 'end') anchor.ancestors['[data-slot="message"][data-align="end"]'] = { dataset: { align } }
  const target = new DomTestElement()
  target.ancestors['a[href]'] = anchor
  viewport.props.onClickCapture({ target, preventDefault() {}, stopPropagation() {} })
}

function fireCapturedHref(handler: (...args: unknown[]) => unknown, href: string, host?: unknown) {
  const anchor = new DomTestElement()
  anchor.attributes.href = href
  if (host) anchor.ancestors['[data-native-exchange]'] = host
  const target = new DomTestElement()
  target.ancestors['a[href]'] = anchor
  let prevented = false
  let stopped = false
  handler({ target, preventDefault: () => { prevented = true }, stopPropagation: () => { stopped = true } })
  assert.equal(prevented, true)
  assert.equal(stopped, true)
}

test('projection is serializable, allowlisted, and does not mutate the adapter view', () => {
  const view = makeView()
  const exchange = view.exchanges[0]!
  const response = exchange.responses[0]!
  const original = structuredClone(view)
  response.blocks = [
    { kind: 'tool', key: 'tool-draft', name: 'draft_skill_from_chat', state: 'completed', toolInput: { authHeader: 'AUTH-SENTINEL' }, toolOutput: { success: true, draft: { name: 'Draft', description: '', instructions: 'safe', confidence: 'high', detectedIntegrations: [], reason: '', accessToken: 'TOKEN-SENTINEL' } } },
    { kind: 'tool', key: 'tool-automation', name: 'draft_automation_from_chat', state: 'completed', toolOutput: { success: true, draft: { name: 'Schedule', description: '', instructions: 'safe', confidence: 'high', detectedIntegrations: [], missingFields: [], reason: '', schedule: { kind: 'daily', hourUTC: 8, minuteUTC: 30, extra: 'SCHEDULE-SENTINEL' }, timezone: 'UTC' } } },
    { kind: 'reasoning', text: 'safe normalized reasoning' },
    { kind: 'generated-ui', part: { type: 'data', id: 'part-1', dataType: 'overlay.generated_ui', data: { version: 1, kind: 'draft.text', body: 'safe generated text', authorization: 'AUTH-SENTINEL', run: { raw: 'RUN-SENTINEL' }, unknownDeep: { secret: 'DEEP-SENTINEL' } } } },
    { kind: 'generated-ui', part: { type: 'data', id: 'part-2', dataType: 'overlay.generated_ui', data: { version: 1, kind: 'connector.connect', serviceName: 'Example', connectUrl: 'https://user:pass@connector.example/connect?access_token=CONNECTOR-SENTINEL', unknown: 'CONNECTOR-SENTINEL' } } },
    { kind: 'file', url: 'https://files.example/api/v1/files/private?token=URL-SENTINEL', mediaType: 'image/png' },
    { kind: 'file', url: 'https://public.example/image.png', mediaType: 'image/png' },
  ] as never
  exchange.user.images = [
    { url: 'https://public.example/user-image.png', name: 'user-image' },
    { url: 'data:image/png;base64,AAAA', name: 'prepared-image' },
  ]
  exchange.user.indexedAttachments = [{ name: 'safe name', fileIds: ['resource-file-1'] }]
  const cyclicUnknown: Record<string, unknown> = { secret: 'CYCLE-SENTINEL' }
  cyclicUnknown.self = cyclicUnknown
  const generatedUi = response.blocks.find((block) => block.kind === 'generated-ui')
  if (generatedUi?.kind === 'generated-ui') (generatedUi.part.data as unknown as Record<string, unknown>).cyclicUnknown = cyclicUnknown
  const cyclicCitationMetadata: Record<string, unknown> = { secret: 'CITATION-SECRET' }
  cyclicCitationMetadata.self = cyclicCitationMetadata
  response.sourceCitations = {
    '1': { kind: 'file', sourceId: 'file-resource-1', title: 'Project plan', snippet: 'Trusted excerpt', extra: 'CITATION-EXTRA-SENTINEL', metadata: cyclicCitationMetadata },
    '2': { kind: 'memory', sourceId: 'memory-resource-2', title: 'Saved preference' },
    '3': { kind: 'message', sourceId: 'message-resource-3' },
    '4': { kind: 'file', sourceId: '../invalid' },
    '01': { kind: 'file', sourceId: 'leading-zero-key' },
    '1000000': { kind: 'file', sourceId: 'oversized-key' },
    '5': { kind: 'file', title: 'Missing source id' },
  } as never
  const before = structuredClone(view)
  const result = createNativeTranscriptDomSnapshot({ ...scope, theme: 'light', view, supportedActions: ['open-draft', 'open-asset', 'open-citation'], query: '', scrollIntent: { id: 'intent-1', kind: 'submission', secret: 'SCROLL-SECRET' } as never, assets: [
    { handle: 'opaque_asset_handle_0001', exchangeId: exchange.id, resourceId: 'resource-file-1', resourceKind: 'file', previewable: true, label: 'safe name', previewDataUrl: 'data:image/png;base64,AAAA' },
    { handle: 'opaque_asset_handle_0002', exchangeId: exchange.id, resourceId: 'https://private.example/file?token=ASSET-URL-SENTINEL', resourceKind: 'file', previewable: true },
    { handle: 'opaque_asset_handle_0003', exchangeId: exchange.id, resourceId: 'resource-not-in-transcript', resourceKind: 'file', previewable: true, label: 'not registered in view' },
    { handle: 'opaque_asset_handle_0004', exchangeId: exchange.id, resourceId: 'file-resource-1', resourceKind: 'file', previewable: true, label: 'Project plan' },
  ] })
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /AUTH-SENTINEL|TOKEN-SENTINEL|RUN-SENTINEL|URL-SENTINEL|ASSET-URL-SENTINEL|resource-file-1|resource-not-in-transcript|public\.example|SCROLL-SECRET|SCHEDULE-SENTINEL|DEEP-SENTINEL|CONNECTOR-SENTINEL|CYCLE-SENTINEL|CITATION-SECRET|CITATION-EXTRA-SENTINEL|message-resource-3|leading-zero-key|oversized-key/)
  assert.match(serialized, /opaque_asset_handle_0001/)
  assert.deepEqual(JSON.parse(serialized), result)
  assert.deepEqual(view, before)
  assert.deepEqual(original.exchanges[0]?.user.text, 'User context')
  assert.deepEqual(result.view.exchanges[0]?.user.indexedAttachments[0]?.fileIds, ['opaque_asset_handle_0001'])
  assert.deepEqual(result.assets.map((asset) => asset.handle), ['opaque_asset_handle_0001', 'opaque_asset_handle_0004'])
  assert.notStrictEqual(result.view, view)
  assert.notStrictEqual(result.view.exchanges[0], exchange)
  assert.equal(result.view.exchanges[0]?.responses[0]?.blocks.find((block) => block.kind === 'reasoning')?.kind, 'reasoning')
  assert.deepEqual(result.view.exchanges[0]?.responses[0]?.sourceCitations, {
    '1': { kind: 'file', sourceId: 'opaque_asset_handle_0004', title: 'Project plan', snippet: 'Trusted excerpt' },
    '2': { kind: 'memory', sourceId: 'memory-resource-2', title: 'Saved preference' },
  })
  assert.notStrictEqual(result.view.exchanges[0]?.responses[0]?.sourceCitations, response.sourceCitations)
  assert.deepEqual(result.view.exchanges[0]?.user.images, [])
  assert.equal(result.view.exchanges[0]?.responses[0]?.blocks.some((block) => block.kind === 'file'), false)
  assert.equal(result.unavailablePreviews.filter((preview) => preview.label === 'File preview unavailable in transcript').length, 2)
  assert.equal(result.unavailablePreviews.some((preview) => preview.label === 'user-image preview unavailable in transcript'), true)
  assert.deepEqual(result.scrollIntent, { id: 'intent-1', kind: 'submission' })
  const withoutDraft = createNativeTranscriptDomSnapshot({ ...scope, theme: 'light', view, supportedActions: ['open-asset'], query: '', scrollIntent: null, assets: [] })
  const retainedTool = withoutDraft.view.exchanges[0]?.responses[0]?.blocks.find((block) => block.kind === 'tool')
  assert.equal(retainedTool?.kind === 'tool' ? retainedTool.toolOutput : undefined, undefined)
})

test('snapshot delivery epoch is a bounded plain number in the serialized contract', () => {
  const view = makeView()
  const snapshotAtEpoch = snapshot(view, { deliveryEpoch: 42 })
  assert.equal(snapshotAtEpoch.deliveryEpoch, 42)
  assert.equal(JSON.parse(JSON.stringify(snapshotAtEpoch)).deliveryEpoch, 42)
  assert.equal(snapshot(view, { deliveryEpoch: MAX_NATIVE_TRANSCRIPT_DELIVERY_EPOCH + 1 }).deliveryEpoch, MAX_NATIVE_TRANSCRIPT_DELIVERY_EPOCH)
  assert.equal(snapshot(view, { deliveryEpoch: -1 }).deliveryEpoch, 0)
  assert.equal(snapshot(view, { deliveryEpoch: 1.5 }).deliveryEpoch, 0)
})

test('projection preserves complete Generated UI draft text through the shared limit and marks overflow unavailable', () => {
  const body = 'G'.repeat(MAX_TRANSCRIPT_TEXT_LENGTH)
  const data: Record<string, unknown> = { version: 1, kind: 'draft.text', body, unknown: 'GENERATED-UI-SECRET' }
  const view = makeGeneratedUiView(data)
  const projected = snapshot(view)
  const generated = projected.view.exchanges[0]!.responses[0]!.blocks.find((block) => block.kind === 'generated-ui')
  assert.equal(generated?.kind === 'generated-ui' && generated.part.data.kind === 'draft.text' ? generated.part.data.body : undefined, body)
  assert.doesNotMatch(JSON.stringify(projected), /GENERATED-UI-SECRET/)
  data.body = 'changed after projection'
  assert.equal(generated?.kind === 'generated-ui' && generated.part.data.kind === 'draft.text' ? generated.part.data.body : undefined, body)

  const oversized = { version: 1, kind: 'draft.text', body: 'X'.repeat(MAX_TRANSCRIPT_TEXT_LENGTH + 1) }
  const oversizedSnapshot = snapshot(makeGeneratedUiView(oversized))
  const unavailable = oversizedSnapshot.view.exchanges[0]!.responses[0]!.blocks.find((block) => block.kind === 'text' && block.text.startsWith('Generated content unavailable:'))
  assert.equal(unavailable?.kind === 'text' ? unavailable.text : undefined, 'Generated content unavailable: exceeds the native transcript limit.')
  assert.doesNotMatch(JSON.stringify(oversizedSnapshot), /X{128}/)
})

test('projection normalizes malformed scalar and enum values without retaining cycles', () => {
  const view = makeView()
  const exchange = view.exchanges[0]!
  const response = exchange.responses[0]!
  const malformed: Record<string, unknown> = { secret: 'SCALAR-PROJECTION-SENTINEL' }
  malformed.self = malformed
  exchange.index = malformed as never
  exchange.mode = malformed as never
  exchange.generationMode = malformed as never
  exchange.selectedResponseIndex = malformed as never
  exchange.status = malformed as never
  exchange.selectedModelId = malformed as never
  exchange.user.createdAt = malformed as never
  response.status = malformed as never
  response.sources = [
    { id: 'invalid-kind', sourceKind: malformed, sourceId: 'not-projected', originIndex: 0 },
    { id: 'safe-url', sourceKind: 'url', sourceId: 'known-source', url: 'https://public.example/known', originIndex: malformed },
  ] as never
  response.blocks = [{ kind: 'tool', key: 'malformed-tool', name: 'safe tool name', state: malformed, toolInput: { token: 'SCALAR-PROJECTION-SENTINEL' } }] as never

  const projected = snapshot(view).view.exchanges[0]!
  const safeResponse = projected.responses[0]!
  assert.equal(projected.index, 0)
  assert.equal(projected.mode, 'ask')
  assert.equal(projected.generationMode, 'text')
  assert.equal(projected.selectedResponseIndex, 0)
  assert.equal(Object.hasOwn(projected.user, 'createdAt'), false)
  assert.equal(projected.selectedModelId, null)
  assert.equal(projected.status, 'error')
  assert.equal(safeResponse.status, 'error')
  assert.deepEqual(safeResponse.sources.map((source) => ({ sourceKind: source.sourceKind, originIndex: source.originIndex })), [{ sourceKind: 'url', originIndex: 0 }])
  assert.deepEqual(safeResponse.blocks, [{ kind: 'text', text: 'Tool status unavailable.' }])
  const serialized = JSON.stringify(projected)
  assert.doesNotMatch(serialized, /SCALAR-PROJECTION-SENTINEL|self/)
})

test('media result overflow is bounded and honestly shown while retaining one prompt', async () => {
  installDomShims()
  const view = makeMediaView(Array.from({ length: 103 }, (_, index) => output(`overflow-${index}`, 'image', 'completed')))
  const projected = makeMediaSnapshot(view)
  assert.equal(projected.media[0]?.results.length, 100)
  assert.equal(projected.media[0]?.omittedResultCount, 3)
  assert.equal(projected.media[0]?.results.every((result) => result.status === 'completed'), true)

  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={projected} onAction={async () => ({ ok: true })} onReady={() => {}} />) })
  const markup = JSON.stringify(renderer.toJSON())
  assert.equal(markup.split('Generate one media result').length - 1, 1)
  assert.equal(renderer.root.findByProps({ 'data-native-media-overflow': 3 }).children.join(''), 'Additional media results not shown: 3')
  await runAct(async () => { renderer.unmount() })
})

test('real Draft CTAs dispatch native-derived skill and full automation graph targets', async () => {
  installDomShims()
  const automationDraft = buildAutomationDraftFromTurn({ userText: 'Create a daily tech news digest email using Gmail' })
  assert.ok(automationDraft.graphSource.length > 256)
  assert.equal((automationDraft.graphSource.match(/step\d+\[/g) ?? []).length, 11)
  const skillDraft = { name: 'Skill draft', description: 'Description', instructions: 'Run the trusted skill', confidence: 'high', detectedIntegrations: ['Gmail'], reason: 'Requested skill' }
  const view = makeRealDraftView(skillDraft, automationDraft)
  const projected = createNativeTranscriptDomSnapshot({
    ...scope, theme: 'dark', view, supportedActions: ['open-draft'], query: '', scrollIntent: null, assets: [],
  })
  const skillExchange = projected.view.exchanges.find((item) => item.turnId === 'skill-turn')!
  const skillResponse = skillExchange.responses[0]!
  const exchange = projected.view.exchanges.find((item) => item.turnId === 'automation-turn')!
  const response = exchange.responses[0]!
  const projectedAutomation = response.blocks.find((block) => block.kind === 'tool' && block.key === 'automation-tool-key')
  assert.equal(projectedAutomation?.kind === 'tool' ? (projectedAutomation.toolOutput as { draft: { graphSource: string } }).draft.graphSource : undefined, automationDraft.graphSource)

  const oversized = { ...automationDraft, graphSource: 'x'.repeat(MAX_AUTOMATION_GRAPH_SOURCE_LENGTH + 1) }
  const oversizedView = makeRealDraftView(skillDraft, oversized)
  const oversizedSnapshot = createNativeTranscriptDomSnapshot({ ...scope, theme: 'dark', view: oversizedView, supportedActions: ['open-draft'], query: '', scrollIntent: null, assets: [] })
  const oversizedExchange = oversizedSnapshot.view.exchanges.find((item) => item.turnId === 'automation-turn')!
  const rejectedBlock = oversizedExchange.responses[0]!.blocks.find((block) => block.kind === 'tool' && block.key === 'automation-tool-key')
  assert.equal(rejectedBlock?.kind === 'tool' ? rejectedBlock.toolOutput : undefined, undefined)
  assert.doesNotMatch(JSON.stringify(oversizedSnapshot), /x{256}/)

  const requests: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={projected} onAction={async (request) => { requests.push(request); return { ok: true } }} onReady={() => {}} />) })
  const labeledButtons = (label: string) => renderer.root.findAllByProps({ children: label }) as Array<{ type: unknown; props: { onClick: () => void } }>
  const buttonByLabel = (label: string) => {
    const button = labeledButtons(label).find((candidate) => candidate.type === 'button')
    assert.ok(button, `missing ${label} button`)
    return button
  }
  const reviewButtons = labeledButtons('Review draft').filter((candidate) => candidate.type === 'button')
  const saveSkill = buttonByLabel('Save skill')
  const createAutomation = buttonByLabel('Create automation')
  assert.equal(reviewButtons.length, 2)
  await runAct(async () => { reviewButtons[0]!.props.onClick(); saveSkill.props.onClick(); reviewButtons[1]!.props.onClick(); createAutomation.props.onClick(); await Promise.resolve() })
  const responseId = response.id
  assert.deepEqual(requests, [
    { kind: 'open-draft', ...scope, exchangeId: skillExchange.id, target: { kind: 'response', responseId: skillResponse.id }, toolKey: 'skill-tool-key' },
    { kind: 'open-draft', ...scope, exchangeId: skillExchange.id, target: { kind: 'response', responseId: skillResponse.id }, toolKey: 'skill-tool-key' },
    { kind: 'open-draft', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId }, toolKey: 'automation-tool-key' },
    { kind: 'open-draft', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId }, toolKey: 'automation-tool-key' },
  ])
  await runAct(async () => { renderer.unmount() })
})

test('shared Generated UI stays read-only and binds prompt, assistant, and Download actions to trusted origins', async () => {
  installDomShims()
  const data = { version: 1, kind: 'draft.text', title: '../../Sensitive: Draft', body: 'Generated draft body' }
  const projected = makeGeneratedUiSnapshot(data)
  const requests: NativeTranscriptActionRequest[] = []
  const download = deferred<NativeTranscriptActionResult>()
  const onAction = async (request: NativeTranscriptActionRequest): Promise<NativeTranscriptActionResult> => {
    requests.push(request)
    return request.kind === 'download-text' ? download.promise : { ok: true }
  }
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={projected} onAction={onAction} onReady={() => {}} />) })
  await settleSharedUi()

  const userCopy = renderer.root.findByProps({ 'aria-label': 'Copy sent message as Markdown' })
  const assistantCopy = renderer.root.findByProps({ 'aria-label': 'Copy response' })
  const cardCopy = renderer.root.findByProps({ 'aria-label': 'Copy' })
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Edit' }).length, 0)
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Save edits' }).length, 0)
  await runAct(async () => {
    await userCopy.props.onClick()
    await assistantCopy.props.onClick()
    await cardCopy.props.onClick()
  })
  const copyRequests = requests.filter((request) => request.kind === 'copy')
  const exchange = projected.view.exchanges[0]!
  const response = exchange.responses[0]!
  assert.deepEqual(copyRequests.map((request) => request.kind === 'copy' ? request.target : null), [
    { kind: 'user', userId: exchange.user.id },
    { kind: 'response', responseId: response.id },
    { kind: 'response', responseId: response.id },
  ])
  assert.equal(copyRequests[0]?.kind === 'copy' ? copyRequests[0].text : '', 'Same text')
  assert.match(copyRequests[2]?.kind === 'copy' ? copyRequests[2].text : '', /Generated draft body/)

  const downloadButton = renderer.root.findByProps({ 'aria-label': 'Download' })
  await runAct(async () => { downloadButton.props.onClick() })
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Download' }).props.disabled, true)
  const downloadRequest = requests.find((request) => request.kind === 'download-text')
  assert.ok(downloadRequest?.kind === 'download-text')
  assert.deepEqual(downloadRequest.target, { kind: 'response', responseId: response.id })
  assert.deepEqual([downloadRequest.workspaceId, downloadRequest.conversationId, downloadRequest.mountNonce, downloadRequest.exchangeId], [scope.workspaceId, scope.conversationId, scope.mountNonce, exchange.id])
  assert.equal(downloadRequest.filename, '-sensitive-draft.txt')
  assert.match(downloadRequest.text, /Generated draft body/)
  download.resolve({ ok: true })
  await runAct(async () => { await download.promise })
  await settleSharedUi()
  assert.equal(Boolean(renderer.root.findByProps({ 'aria-label': 'Download' }).props.disabled), false)
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('shared Generated UI Download rejection shows retry and retries the same sanitized native action', async () => {
  installDomShims()
  const projected = makeGeneratedUiSnapshot({ version: 1, kind: 'draft.text', title: '../Mail: Draft', body: 'Retry body' })
  const requests: NativeTranscriptActionRequest[] = []
  let attempts = 0
  let renderer!: ReturnType<typeof create>
  await runAct(async () => {
    renderer = create(<NativeSharedTranscript snapshot={projected} onAction={async (request) => {
      requests.push(request)
      if (request.kind === 'download-text' && ++attempts === 1) return { ok: false, error: 'action-failed' }
      return { ok: true }
    }} onReady={() => {}} />)
  })
  await settleSharedUi()
  const download = renderer.root.findByProps({ 'aria-label': 'Download' })
  await runAct(async () => { download.props.onClick() })
  await settleSharedUi()
  assert.match(JSON.stringify(renderer.toJSON()), /Download failed\. Try again\./)
  assert.equal(Boolean(renderer.root.findByProps({ 'aria-label': 'Download' }).props.disabled), false)
  await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Download' }).props.onClick() })
  await settleSharedUi()
  const downloads = requests.filter((request) => request.kind === 'download-text')
  assert.equal(downloads.length, 2)
  assert.equal(downloads.every((request) => request.kind === 'download-text' && request.filename === '-mail-draft.txt'), true)
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('user Copy remains bound to the prompt when assistant selection changes during native work', async () => {
  installDomShims()
  const view = makeGeneratedUiView({ version: 1, kind: 'draft.text', body: 'Same text' })
  const pending = deferred<NativeTranscriptActionResult>()
  const requests: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => {
    renderer = create(<NativeSharedTranscript snapshot={snapshot(view, { supportedActions: ['copy', 'reply'] })} onAction={async (request) => { requests.push(request); return pending.promise }} onReady={() => {}} />)
  })
  const userCopy = renderer.root.findByProps({ 'aria-label': 'Copy sent message as Markdown' })
  await runAct(async () => { userCopy.props.onClick() })
  await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Next response' }).props.onClick() })
  pending.resolve({ ok: false, error: 'action-failed' })
  await runAct(async () => { await pending.promise })
  await settleSharedUi()
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0]?.kind === 'copy' ? requests[0].target : null, { kind: 'user', userId: view.exchanges[0]!.user.id })
  assert.equal(requests[0]?.kind === 'copy' ? requests[0].text : '', 'Same text')
  assert.equal(renderer.root.findByProps({ role: 'status' }).children.join(''), 'Action unavailable')
  await runAct(async () => { renderer.unmount() })
})

test('focus epochs cancel captured Copy, Download, and Draft callbacks while preserving response selection', async () => {
  installDomShims()
  const automationDraft = buildAutomationDraftFromTurn({ userText: 'Create a daily tech news digest email using Gmail' })
  const skillDraft = { name: 'Skill draft', description: 'Description', instructions: 'Run the trusted skill', confidence: 'high', detectedIntegrations: ['Gmail'], reason: 'Requested skill' }
  const generatedView = makeView()
  for (const response of generatedView.exchanges[0]!.responses) response.blocks = [generatedUiBlock({ version: 1, kind: 'draft.text', body: 'Focus epoch text' })]
  const draftView = makeRealDraftView(skillDraft, automationDraft)
  const cases = [
    { kind: 'copy', view: makeGeneratedUiView({ version: 1, kind: 'draft.text', body: 'Same text' }), actions: ['copy', 'reply'] as NativeTranscriptActionRequest['kind'][], button: { 'aria-label': 'Copy sent message as Markdown' } },
    { kind: 'download-text', view: generatedView, actions: ['copy', 'download-text', 'reply'] as NativeTranscriptActionRequest['kind'][], button: { 'aria-label': 'Download' } },
    { kind: 'open-draft', view: draftView, actions: ['open-draft'] as NativeTranscriptActionRequest['kind'][], button: { children: 'Review draft' } },
  ]
  for (const actionCase of cases) {
    const pending = deferred<NativeTranscriptActionResult>()
    const requests: NativeTranscriptActionRequest[] = []
    const readyFocuses: string[] = []
    let renderer!: ReturnType<typeof create>
    const initial = snapshot(actionCase.view, { supportedActions: actionCase.actions })
    await runAct(async () => {
      renderer = create(<NativeSharedTranscript snapshot={initial} onAction={async (request) => { requests.push(request); return pending.promise }} onReady={(current) => { readyFocuses.push(current.focusNonce) }} />)
    })
    await settleSharedUi()
    if (actionCase.kind === 'download-text') await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Next response' }).props.onClick() })
    const button = actionCase.kind === 'open-draft'
      ? (renderer.root.findAllByProps(actionCase.button) as Array<{ type: unknown; props: { onClick: () => void } }>).find((candidate) => candidate.type === 'button')
      : renderer.root.findByProps(actionCase.button)
    assert.ok(button)
    const oldCallback = button.props.onClick as () => void
    await runAct(async () => { oldCallback() })
    assert.equal(requests.length, 1, `${actionCase.kind} starts exactly one native operation`)
    assert.equal(requests[0]?.kind, actionCase.kind)
    assert.equal(requests[0]?.focusNonce, 'focus-1')

    const nextSnapshot = snapshot(actionCase.view, { focusNonce: 'focus-2', supportedActions: actionCase.actions })
    await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={nextSnapshot} onAction={async (request) => { requests.push(request); return pending.promise }} onReady={(current) => { readyFocuses.push(current.focusNonce) }} />) })
    await settleSharedUi()
    if (actionCase.kind === 'download-text') {
      assert.equal(renderer.root.findByProps({ 'data-native-exchange': 'turn-1' }).props['data-native-response-id'], generatedView.exchanges[0]!.responses[1]!.id)
    }
    assert.ok(readyFocuses.includes('focus-2'))
    const readyCountOnResume = readyFocuses.filter((focusNonce) => focusNonce === 'focus-2').length
    const previousVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await runAct(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await settleSharedUi()
    })
    assert.ok(readyFocuses.filter((focusNonce) => focusNonce === 'focus-2').length > readyCountOnResume)
    if (previousVisibility) Object.defineProperty(document, 'visibilityState', previousVisibility)
    else Reflect.deleteProperty(document, 'visibilityState')
    const readyCountBeforeDeliveryRetry = readyFocuses.filter((focusNonce) => focusNonce === 'focus-2').length
    const deliveryRetrySnapshot = { ...nextSnapshot, deliveryEpoch: nextSnapshot.deliveryEpoch + 1 }
    await runAct(async () => {
      renderer.update(<NativeSharedTranscript snapshot={deliveryRetrySnapshot} onAction={async (request) => { requests.push(request); return pending.promise }} onReady={(current) => { readyFocuses.push(current.focusNonce) }} />)
    })
    await settleSharedUi()
    assert.ok(readyFocuses.filter((focusNonce) => focusNonce === 'focus-2').length > readyCountBeforeDeliveryRetry)
    await runAct(async () => { oldCallback() })
    await settleSharedUi()
    assert.equal(requests.length, 1, `captured ${actionCase.kind} callback is rejected in the new focus epoch`)
    pending.resolve({ ok: false, error: 'action-failed' })
    await runAct(async () => { await pending.promise })
    await settleSharedUi()
    assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0, `stale ${actionCase.kind} failure is quiet`)
    await runAct(async () => { renderer.unmount() })
  }
})

test('shared Generated UI questionnaires are disabled and connector navigation is absent in native read-only mode', async () => {
  installDomShims()
  const view = makeView()
  const response = view.exchanges[0]!.responses[0]!
  response.blocks = [
    generatedUiBlock({ version: 1, kind: 'questionnaire', prompt: 'Choose a safe option', choices: [{ id: 'choice-1', label: 'First choice' }], multiple: false }),
    generatedUiBlock({ version: 1, kind: 'connector.connect', serviceName: 'Example', connectUrl: 'https://public.example/connect' }, 'connector-part'),
  ]
  const projected = snapshot(view, { supportedActions: ['copy', 'download-text', 'reply'] })
  const nativeActions: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={projected} onAction={async (request) => { nativeActions.push(request); return { ok: true } }} onReady={() => {}} />) })
  await settleSharedUi()

  assert.ok(renderer.root.findAllByProps({ disabled: true }).length > 0)
  assert.equal(renderer.root.findAllByProps({ type: 'submit' }).length, 0)
  assert.equal(JSON.stringify(renderer.toJSON()).includes('"Connect"'), false)
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Edit' }).length, 0)
  assert.equal(renderer.root.findAllByProps({ children: 'Submit' }).length, 0)
  assert.equal(renderer.root.findAllByProps({ children: 'Send' }).length, 0)
  assert.equal(nativeActions.length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('unsupported Copy and Download are hidden from the real DOM accessibility tree', async () => {
  installDomShims()
  const data = { version: 1, kind: 'draft.text', body: 'Safe text action fixture' }
  const disabledSnapshot = snapshot(makeGeneratedUiView(data), { supportedActions: ['reply'], mountNonce: 'unsupported-capabilities' })
  const supportedSnapshot = snapshot(makeGeneratedUiView(data), { supportedActions: ['copy', 'download-text', 'reply'], mountNonce: 'supported-capabilities' })
  const userOnlyView = makeView()
  userOnlyView.exchanges[0]!.responses = []
  const userOnlySnapshot = snapshot(userOnlyView, { supportedActions: ['reply'], mountNonce: 'user-only-unsupported-copy' })
  const markup = renderToStaticMarkup(
    <>
      <section id="unsupported"><NativeSharedTranscript snapshot={disabledSnapshot} onAction={async () => ({ ok: true })} onReady={() => {}} /></section>
      <section id="supported"><NativeSharedTranscript snapshot={supportedSnapshot} onAction={async () => ({ ok: true })} onReady={() => {}} /></section>
      <section id="user-only"><NativeSharedTranscript snapshot={userOnlySnapshot} onAction={async () => ({ ok: true })} onReady={() => {}} /></section>
    </>,
  )
  const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>${css}</style>${markup}`, { waitUntil: 'domcontentloaded' })
    const unsupported = page.locator('#unsupported')
    const supported = page.locator('#supported')
    const userOnly = page.locator('#user-only')
    for (const name of ['Copy sent message as Markdown', 'Copy response', 'Copy', 'Download']) {
      assert.equal(await unsupported.getByRole('button', { name, exact: true }).count(), 0, `${name} must be absent from unsupported accessibility tree`)
      assert.equal(await supported.getByRole('button', { name, exact: true }).count(), 1, `${name} must remain available when supported`)
    }
    assert.equal(await userOnly.getByRole('button', { name: 'Copy sent message as Markdown', exact: true }).count(), 0)
    assert.equal(await userOnly.locator('[aria-label="Copy sent message as Markdown"]').evaluate((element) => getComputedStyle(element).display), 'none')
    assert.equal(await unsupported.locator('[aria-label="Copy response"]').evaluate((element) => getComputedStyle(element).display), 'none')
    assert.equal(await unsupported.locator('[aria-label="Download"]').evaluate((element) => getComputedStyle(element).display), 'none')
  } finally {
    await browser.close()
  }
})

test('mounted transcript Markdown uses generated CSS theme colors across light and dark changes', async () => {
  const view = makeView()
  view.exchanges[0]!.responses[0]!.blocks = [{
    kind: 'text',
    text: [
      'Assistant semantic color sample.',
      String.raw`$$\frac{1}{2} + \frac{1}{3} = \frac{5}{6}$$`,
      '| Column | Value |\n| --- | --- |\n| Theme | semantic |',
      '| Renderer | Shared | Column three | Column four | Column five | Column six |\n| --- | --- | --- | --- | --- | --- |\n| Renderer | Shared | table | cells | remain | readable |',
      '```ts\nconst semanticColor = "foreground"\n```',
    ].join('\n\n'),
  } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 412, height: 772 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    const katexCss = readFileSync('assets/shared-markdown-katex.generated.css', 'utf8')
    await page.setContent(`<style>${css}\n${katexCss}\nhtml,body,#root{height:100%;margin:0} #root{height:772px;width:100%}</style><div id="root"></div>`)
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })

    const readStyles = async () => page.evaluate(() => {
      const prompt = document.querySelector<HTMLElement>('[data-native-prompt-exchange="true"] .typeset.markdown-content')
      const assistant = document.querySelector<HTMLElement>('[data-native-assistant-exchange="true"] .typeset.markdown-content')
      const math = assistant?.querySelector<HTMLElement>('.katex')
      const header = assistant?.querySelector<HTMLElement>('table th')
      const cell = assistant?.querySelector<HTMLElement>('table td')
      const code = assistant?.querySelector<HTMLElement>('pre code')
      const codeText = code?.querySelector<HTMLElement>('span') ?? code
      const body = document.body
      const root = document.documentElement
      const scroller = document.querySelector<HTMLElement>('#root [data-theme]')
      if (!prompt || !assistant || !math || !header || !cell || !code || !codeText || !scroller) {
        throw new Error('Expected mounted prompt, assistant, math, table, code, and conversation scroller')
      }
      return {
        theme: root.dataset.theme ?? '',
        rootForeground: getComputedStyle(root).getPropertyValue('--foreground').trim(),
        rootColorForeground: getComputedStyle(root).getPropertyValue('--color-foreground').trim(),
        bodyColor: getComputedStyle(body).color,
        bodyBackground: getComputedStyle(body).backgroundColor,
        scrollerColor: getComputedStyle(scroller).color,
        scrollerBackground: getComputedStyle(scroller).backgroundColor,
        promptColor: getComputedStyle(prompt).color,
        assistantColor: getComputedStyle(assistant).color,
        mathColor: getComputedStyle(math).color,
        tableHeaderColor: getComputedStyle(header).color,
        tableCellColor: getComputedStyle(cell).color,
        tableHeaderPaddingLeft: getComputedStyle(header).paddingLeft,
        tableHeaderPaddingRight: getComputedStyle(header).paddingRight,
        tableCellPaddingLeft: getComputedStyle(cell).paddingLeft,
        tableCellPaddingRight: getComputedStyle(cell).paddingRight,
        tableCellWhiteSpace: getComputedStyle(cell).whiteSpace,
        tableCellOverflowWrap: getComputedStyle(cell).overflowWrap,
        codeBlockColor: getComputedStyle(code.closest('pre')!).color,
        codeColor: getComputedStyle(codeText).color,
        codeBackground: getComputedStyle(code.closest('pre')!).backgroundColor,
      }
    })

    const renderTheme = async (theme: 'dark' | 'light', firstMount: boolean) => {
      const nextSnapshot = snapshot(view, { theme, supportedActions: ['copy'] })
      await page.evaluate(({ value, first }) => {
        const state = window as unknown as {
          __mountNativeTranscript: (snapshot: unknown) => void
          __updateNativeTranscript: (snapshot: unknown) => void
        }
        if (first) state.__mountNativeTranscript(value)
        else state.__updateNativeTranscript(value)
      }, { value: nextSnapshot, first: firstMount })
      await page.waitForFunction((expectedTheme) => {
        const assistant = document.querySelector('[data-native-assistant-exchange="true"] .typeset.markdown-content')
        return document.documentElement.dataset.theme === expectedTheme &&
          !!assistant?.querySelector('.katex') && !!assistant.querySelector('table td') && !!assistant.querySelector('pre code')
      }, theme)
      return readStyles()
    }

    const expected = {
      dark: { foreground: 'rgb(245, 245, 245)', background: 'rgb(9, 9, 11)', token: '#f5f5f5' },
      light: { foreground: 'rgb(10, 10, 10)', background: 'rgb(250, 250, 250)', token: '#0a0a0a' },
    } as const
    const contrastRatio = (foreground: string, background: string) => {
      const luminance = (color: string) => {
        const match = color.match(/^rgba?\(([^)]+)\)$/)
        assert.ok(match, `Expected computed RGB color, received ${color}`)
        const channels = match[1]!.split(',').slice(0, 3).map((channel) => Number(channel.trim()) / 255)
        const [red, green, blue] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
      }
      const foregroundLuminance = luminance(foreground)
      const backgroundLuminance = luminance(background)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }
    const assertColors = (styles: Awaited<ReturnType<typeof readStyles>>, theme: keyof typeof expected) => {
      const colors = expected[theme]
      assert.equal(styles.theme, theme)
      assert.equal(styles.rootForeground, colors.token)
      assert.equal(styles.rootColorForeground, colors.token)
      assert.equal(styles.bodyColor, colors.foreground)
      assert.equal(styles.bodyBackground, colors.background)
      assert.equal(styles.scrollerColor, colors.foreground)
      assert.equal(styles.scrollerBackground, colors.background)
      for (const key of ['promptColor', 'assistantColor', 'mathColor', 'tableHeaderColor', 'tableCellColor'] as const) {
        assert.equal(styles[key], colors.foreground, `${theme} ${key}: ${JSON.stringify(styles)}`)
      }
      for (const key of ['tableHeaderPaddingLeft', 'tableHeaderPaddingRight', 'tableCellPaddingLeft', 'tableCellPaddingRight'] as const) {
        assert.ok(Number.parseFloat(styles[key]) >= 12, `${theme} ${key}: ${JSON.stringify(styles)}`)
      }
      assert.equal(styles.tableCellWhiteSpace, 'normal')
      assert.equal(styles.tableCellOverflowWrap, 'anywhere')
      assert.equal(styles.codeBlockColor, colors.foreground)
      const codeBackground = styles.codeBackground === 'rgba(0, 0, 0, 0)' ? colors.background : styles.codeBackground
      assert.ok(contrastRatio(styles.codeColor, codeBackground) >= 4.5, `${theme} code contrast: ${JSON.stringify(styles)}`)
    }

    const assertTableLayout = async (theme: 'dark' | 'light', width: number, shouldOverflow: boolean) => {
      await page.setViewportSize({ width, height: 772 })
      await page.waitForFunction((expectedWidth) => window.innerWidth === expectedWidth, width)
      const layout = await page.evaluate(() => {
        const assistant = document.querySelector<HTMLElement>('[data-native-assistant-exchange="true"] .typeset.markdown-content')
        const table = assistant?.querySelectorAll<HTMLTableElement>('table')[1]
        const wrapper = table?.closest<HTMLElement>('.table-wrapper')
        const cell = table?.querySelector<HTMLElement>('td')
        if (!table || !wrapper || !cell) throw new Error('Expected wide table in the shared Markdown wrapper')
        return {
          viewportWidth: window.innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          wrapperWidth: wrapper.clientWidth,
          wrapperScrollWidth: wrapper.scrollWidth,
          wrapperOverflowX: getComputedStyle(wrapper).overflowX,
          cellPaddingLeft: getComputedStyle(cell).paddingLeft,
          cellPaddingRight: getComputedStyle(cell).paddingRight,
          cellWhiteSpace: getComputedStyle(cell).whiteSpace,
          cellOverflowWrap: getComputedStyle(cell).overflowWrap,
        }
      })
      assert.equal(layout.viewportWidth, width)
      assert.ok(layout.pageWidth <= width + 1, `${theme} page width ${width}: ${JSON.stringify(layout)}`)
      assert.ok(layout.bodyWidth <= width + 1, `${theme} body width ${width}: ${JSON.stringify(layout)}`)
      assert.equal(layout.wrapperOverflowX, 'auto')
      assert.equal(layout.wrapperScrollWidth > layout.wrapperWidth + 1, shouldOverflow, `${theme} table width ${width}: ${JSON.stringify(layout)}`)
      assert.ok(Number.parseFloat(layout.cellPaddingLeft) >= 12)
      assert.ok(Number.parseFloat(layout.cellPaddingRight) >= 12)
      assert.equal(layout.cellWhiteSpace, 'normal')
      assert.equal(layout.cellOverflowWrap, 'anywhere')
      return layout
    }

    const darkStyles = await renderTheme('dark', true)
    assertColors(darkStyles, 'dark')
    const darkNarrow = await assertTableLayout('dark', 412, true)
    const darkWide = await assertTableLayout('dark', 1280, false)
    const lightStyles = await renderTheme('light', false)
    assertColors(lightStyles, 'light')
    const lightNarrow = await assertTableLayout('light', 412, true)
    const lightWide = await assertTableLayout('light', 1280, false)
    const darkAgainStyles = await renderTheme('dark', false)
    assertColors(darkAgainStyles, 'dark')
    console.log('Mounted transcript table layout evidence:', JSON.stringify({ darkNarrow, darkWide, lightNarrow, lightWide }))
    console.log('Mounted transcript generated-CSS theme styles:', JSON.stringify({ darkStyles, lightStyles, darkAgainStyles }))
  } finally {
    await browser.close()
  }
})

test('mounted React selection belongs to the selected assistant wrapper, not the prompt-only Message', async () => {
  const view = makeView()
  const originalResponse = view.exchanges[0]!.responses[0]!
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent('<style>' + css + '</style><div id="root"></div>')
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    const currentSnapshot = snapshot(view)
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, currentSnapshot)
    await page.locator('[data-native-assistant-exchange="true"]').waitFor()
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: Array<{ focusNonce: string }> }).__nativeTranscriptReady.some((scope) => scope.focusNonce === 'focus-1'))
    const initial = await page.evaluate(() => {
      const prompt = document.querySelector<HTMLElement>('[data-native-prompt-exchange="true"]')
      const dummy = prompt?.querySelector<HTMLElement>('[data-slot="message"][data-align="start"]')
      const assistant = document.querySelector<HTMLElement>('[data-native-assistant-exchange="true"]')
      const message = assistant?.querySelector<HTMLElement>('[data-slot="message"][data-align="start"]')
      if (!assistant || !message) throw new Error('assistant Message not mounted')
      const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT)
      let textNode: Node | null = walker.nextNode()
      while (textNode && !textNode.textContent?.includes('Variant A')) textNode = walker.nextNode()
      if (!textNode?.textContent) throw new Error('assistant text not mounted')
      const start = textNode.textContent.indexOf('Variant A')
      const selection = window.getSelection()
      const range = document.createRange()
      range.setStart(textNode, start)
      range.setEnd(textNode, start + 'Variant A'.length)
      selection?.removeAllRanges()
      selection?.addRange(range)
      ;(window as unknown as { __nativeTranscriptOriginalSelectionNode?: Node }).__nativeTranscriptOriginalSelectionNode = textNode
      return {
        selectedText: selection?.toString() ?? '',
        selectedResponseId: assistant.dataset.nativeAssistantResponseId,
        dummyDisplay: dummy ? getComputedStyle(dummy).display : null,
        gap: Number.parseFloat(getComputedStyle(prompt!).marginBlockEnd),
        geometryGap: assistant.getBoundingClientRect().top - prompt!.getBoundingClientRect().bottom,
        anchorResponseId: selection?.anchorNode?.parentElement?.closest('[data-native-assistant-exchange="true"]')?.getAttribute('data-native-assistant-response-id'),
      }
    })
    assert.equal(initial.selectedText, 'Variant A')
    assert.equal(initial.anchorResponseId, originalResponse.id)
    assert.equal(initial.selectedResponseId, originalResponse.id)
    assert.equal(initial.dummyDisplay, 'none')
    assert.equal(initial.gap, 8)
    assert.equal(initial.geometryGap, 8)
    await page.waitForTimeout(25)

    const updatedView = makeView()
    updatedView.exchanges[0]!.responses[0]!.blocks = [{ kind: 'text', text: '**Variant A** refreshed' } as never]
    const updatedSnapshot = snapshot(updatedView)
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, updatedSnapshot)
    await page.waitForTimeout(25)
    const restored = await page.evaluate(() => ({
      selectedText: window.getSelection()?.toString() ?? '',
      rangeCount: window.getSelection()?.rangeCount ?? 0,
      anchorConnected: document.contains(window.getSelection()?.anchorNode ?? null),
      anchorText: window.getSelection()?.anchorNode?.textContent ?? null,
      anchorOffset: window.getSelection()?.anchorOffset ?? -1,
      originalNodeConnected: Boolean((window as unknown as { __nativeTranscriptOriginalSelectionNode?: Node }).__nativeTranscriptOriginalSelectionNode?.isConnected),
      assistantText: document.querySelector('[data-native-assistant-exchange="true"]')?.textContent ?? null,
      responseId: window.getSelection()?.anchorNode?.parentElement?.closest('[data-native-assistant-exchange="true"]')?.getAttribute('data-native-assistant-response-id') ?? null,
    }))
    assert.equal(restored.selectedText, 'Variant A', JSON.stringify(restored))
    assert.equal(restored.originalNodeConnected, false)
    assert.equal(restored.responseId, originalResponse.id)

    await page.getByRole('button', { name: 'Next response' }).click()
    const secondResponseId = view.exchanges[0]!.responses[1]!.id
    const viewport = page.getByLabel('Conversation')
    await viewport.evaluate((element) => {
      const node = element as HTMLElement
      node.style.height = '120px'
      node.style.overflowY = 'auto'
      node.scrollTop = 40
      node.dispatchEvent(new Event('scroll'))
    })
    const scrollBeforeFocus = await viewport.evaluate((element) => (element as HTMLElement).scrollTop)
    const focusView = makeView()
    focusView.exchanges[0]!.selectedResponseIndex = 0
    const focusSnapshot = snapshot(focusView, { focusNonce: 'focus-2' })
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, focusSnapshot)
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: Array<{ focusNonce: string }> }).__nativeTranscriptReady.some((scope) => scope.focusNonce === 'focus-2'))
    const afterFocus = await page.evaluate(() => ({
      responseId: document.querySelector('[data-native-exchange="turn-1"]')?.getAttribute('data-native-response-id'),
      scrollTop: document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop ?? 0,
    }))
    assert.equal(afterFocus.responseId, secondResponseId)
    assert.ok(scrollBeforeFocus > 0)
    assert.equal(afterFocus.scrollTop, scrollBeforeFocus)
  } finally {
    await browser.close()
  }
})

test('mounted React scroll intents wait for readiness, deduplicate old IDs, and retry filtered reply targets', async () => {
  const view = makeView()
  view.exchanges[0]!.user.text = 'Long preceding exchange content '.repeat(120)
  const parent = structuredClone(view.exchanges[0]!)
  parent.id = 'parent-exchange'
  parent.turnId = 'parent-turn'
  parent.index = 1
  parent.user.id = 'parent-user'
  parent.user.text = 'Parent reply target '.repeat(120)
  parent.responses.forEach((response, index) => {
    response.id = `parent-response-${index}`
    response.blocks = [{ kind: 'text', text: `Parent response ${index}` } as never]
  })
  view.exchanges[0]!.user.replyThread = { replyToTurnId: 'parent-turn', replySnippet: 'Parent reply target' }
  const preceding = Array.from({ length: 4 }, (_, index) => {
    const exchange = structuredClone(view.exchanges[0]!)
    exchange.id = `preceding-exchange-${index}`
    exchange.turnId = `preceding-turn-${index}`
    exchange.index = index + 1
    exchange.user.id = `preceding-user-${index}`
    exchange.user.text = `Preceding exchange ${index}`
    exchange.responses.forEach((response, responseIndex) => {
      response.id = `preceding-response-${index}-${responseIndex}`
      response.blocks = [{ kind: 'text', text: `Preceding response ${index}` } as never]
    })
    return exchange
  })
  parent.index = preceding.length + 1
  Object.assign(view, { exchanges: [view.exchanges[0]!, ...preceding, parent] })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 640, height: 420 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:420px;width:640px}</style><div id="root"></div>`)
    await page.evaluate(() => {
      const state = window as unknown as {
        __nativeScrollIntoViewCalls: Array<Record<string, unknown>>
        __nativeScrollToCalls: Array<Record<string, unknown>>
        __nativeScrollTargetId: string
        __nativeViewportScrollEvents: number[]
        __nativeReplyGeometrySample: { scrollTop: number; targetTop: number; stableFrames: number } | null
      }
      state.__nativeScrollIntoViewCalls = []
      state.__nativeScrollToCalls = []
      state.__nativeScrollTargetId = 'parent-exchange'
      state.__nativeViewportScrollEvents = []
      state.__nativeReplyGeometrySample = null
      const nativeScrollIntoView = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = function (options?: ScrollIntoViewOptions) {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        const target = this as HTMLElement
        const record: Record<string, unknown> = {
          targetId: target.dataset.nativeExchange ?? '',
          options: options ? { block: options.block, behavior: options.behavior } : null,
          computedScrollBehavior: viewport ? getComputedStyle(viewport).scrollBehavior : '',
          beforeScrollTop: viewport?.scrollTop ?? -1,
          beforeTargetTop: target.getBoundingClientRect().top,
        }
        state.__nativeScrollIntoViewCalls.push(record)
        nativeScrollIntoView.call(this, options)
        record.afterScrollTop = viewport?.scrollTop ?? -1
        record.afterTargetTop = target.getBoundingClientRect().top
      }
      const nativeScrollTo = Element.prototype.scrollTo
      Element.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
        const viewport = this as HTMLElement
        const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
        const record: Record<string, unknown> = {
          targetId: state.__nativeScrollTargetId,
          options: typeof options === 'number' ? { left: options, top: y } : options ? { top: options.top, behavior: options.behavior } : null,
          computedScrollBehavior: getComputedStyle(viewport).scrollBehavior,
          beforeScrollTop: viewport.scrollTop,
          beforeTargetTop: target?.getBoundingClientRect().top ?? -1,
        }
        if (viewport.getAttribute('aria-label') === 'Conversation') state.__nativeScrollToCalls.push(record)
        Reflect.apply(nativeScrollTo, this, typeof options === 'number' ? [options, y ?? 0] : [options ?? {}])
        record.afterScrollTop = viewport.scrollTop
        record.afterTargetTop = target?.getBoundingClientRect().top ?? -1
      }
      document.addEventListener('scroll', (event) => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        if (viewport && event.target === viewport) state.__nativeViewportScrollEvents.push(viewport.scrollTop)
      }, true)
    })
    await page.evaluate(() => {
      Object.defineProperty(document, 'fonts', { configurable: true, value: {
        ready: new Promise<void>((resolve) => { (window as unknown as { __resolveNativeFonts?: () => void }).__resolveNativeFonts = resolve }),
      } })
    })
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { query: '', scrollIntent: { id: 'initial-end-1', kind: 'initial-end' } }))
    await page.locator('[data-native-exchange="turn-1"]').waitFor()
    const beforeReady = await page.evaluate(() => ({
      scrollTop: document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop ?? -1,
      readyCount: (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length,
    }))
    assert.equal(beforeReady.scrollTop, 0)
    assert.equal(beforeReady.readyCount, 0)
    await page.evaluate(() => (window as unknown as { __resolveNativeFonts?: () => void }).__resolveNativeFonts?.())
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > viewport.clientHeight && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2)
    })

    const update = async (next: ReturnType<typeof snapshot>) => page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, next)
    await update(snapshot(view, { query: '', scrollIntent: { id: 'restore-1', kind: 'restore', scrollTop: 60 } }))
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop === 60)
    await update(snapshot(view, { scrollIntent: { id: 'submission-1', kind: 'submission' } }))
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2)
    })
    await update(snapshot(view, { scrollIntent: { id: 'restore-2', kind: 'restore', scrollTop: 82 } }))
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop === 82)
    await update(snapshot(view, { scrollIntent: { id: 'initial-end-1', kind: 'initial-end' } }))
    await page.waitForTimeout(40)
    assert.equal(await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollTop), 82)

    const viewportBox = await page.locator('[aria-label="Conversation"]').boundingBox()
    assert.ok(viewportBox)
    const beforeGesture = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollTop)
    await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2)
    await page.mouse.wheel(0, 5000)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
    const bottomScrollTop = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollTop)
    await page.mouse.wheel(0, -5000)
    await page.waitForFunction((top) => document.querySelector<HTMLElement>('[aria-label="Conversation"]')!.scrollTop < top - 1, bottomScrollTop)
    assert.notEqual(await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollTop), beforeGesture)

    await update(snapshot(view, { query: '__no_matching_exchange__', scrollIntent: { id: 'reply-wait-1', kind: 'reply', exchangeId: 'parent-exchange' } }))
    await page.waitForFunction(() => !document.querySelector('[data-native-exchange="parent-exchange"]'))
    await page.waitForTimeout(40)
    const filteredScrollTop = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollTop)
    const missingTargetState = await page.evaluate(() => {
      const state = window as unknown as { __nativeScrollIntoViewCalls: Array<Record<string, unknown>>; __nativeScrollToCalls: Array<Record<string, unknown>>; __nativeViewportScrollEvents: number[] }
      return { targetMounted: Boolean(document.querySelector('[data-native-exchange="parent-exchange"]')), calls: state.__nativeScrollToCalls.filter((call) => (call.options as { behavior?: string } | null)?.behavior === 'instant').length, scrollIntoViewCalls: state.__nativeScrollIntoViewCalls.length, scrollEventCount: state.__nativeViewportScrollEvents.length }
    })
    assert.equal(missingTargetState.targetMounted, false)
    assert.equal(missingTargetState.calls, 0)
    await update(snapshot(view, { query: '', scrollIntent: { id: 'reply-wait-1', kind: 'reply', exchangeId: 'parent-exchange' } }))
    await page.locator('[data-native-exchange="parent-exchange"]').waitFor()
    await page.waitForFunction((scrollEventBaseline) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
      const state = window as unknown as {
        __nativeScrollIntoViewCalls: Array<Record<string, unknown>>
        __nativeScrollToCalls: Array<Record<string, unknown>>
        __nativeViewportScrollEvents: number[]
        __nativeReplyGeometrySample: { scrollTop: number; targetTop: number; stableFrames: number } | null
      }
      const calls = state.__nativeScrollToCalls.filter((call) => call.targetId === 'parent-exchange' && (call.options as { behavior?: string } | null)?.behavior === 'instant')
      if (!viewport || !target || calls.length !== 1) return false
      const scrollTop = viewport.scrollTop
      const targetTop = target.getBoundingClientRect().top
      const viewportTop = viewport.getBoundingClientRect().top
      const lastScrollEvent = state.__nativeViewportScrollEvents.at(-1)
      const settled = state.__nativeViewportScrollEvents.length > scrollEventBaseline &&
        lastScrollEvent !== undefined && Math.abs(lastScrollEvent - scrollTop) < 0.5 && Math.abs(targetTop - viewportTop) < 1
      const previous = state.__nativeReplyGeometrySample
      const stableFrames = settled && previous && Math.abs(previous.scrollTop - scrollTop) < 0.5 && Math.abs(previous.targetTop - targetTop) < 0.5
        ? previous.stableFrames + 1
        : 0
      state.__nativeReplyGeometrySample = { scrollTop, targetTop, stableFrames }
      return settled && stableFrames >= 3
    }, missingTargetState.scrollEventCount, { polling: 'raf', timeout: 5000 }).catch(async (error: unknown) => {
      const geometry = await page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
        const state = window as unknown as {
          __nativeScrollIntoViewCalls: Array<Record<string, unknown>>
          __nativeScrollToCalls: Array<Record<string, unknown>>
          __nativeViewportScrollEvents: number[]
          __nativeReplyGeometrySample: unknown
        }
        return {
          scrollTop: viewport?.scrollTop,
          scrollHeight: viewport?.scrollHeight,
          clientHeight: viewport?.clientHeight,
          targetTop: target?.getBoundingClientRect().top,
          calls: state.__nativeScrollToCalls,
          scrollIntoViewCalls: state.__nativeScrollIntoViewCalls,
          events: state.__nativeViewportScrollEvents,
          sample: state.__nativeReplyGeometrySample,
        }
      })
      throw new Error(`${String(error)} ${JSON.stringify({ missingTargetState, geometry })}`)
    })
    const replyGeometry = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
      const state = window as unknown as { __nativeScrollIntoViewCalls: Array<Record<string, unknown>>; __nativeScrollToCalls: Array<Record<string, unknown>>; __nativeViewportScrollEvents: number[] }
      return {
        scrollTop: viewport?.scrollTop, scrollHeight: viewport?.scrollHeight, clientHeight: viewport?.clientHeight,
        targetTop: target?.getBoundingClientRect().top, viewportTop: viewport?.getBoundingClientRect().top,
        paddingTop: viewport ? Number.parseFloat(getComputedStyle(viewport).paddingTop) || 0 : 0,
        scrollBehavior: viewport ? getComputedStyle(viewport).scrollBehavior : '',
        calls: state.__nativeScrollToCalls.filter((call) => call.targetId === 'parent-exchange' && (call.options as { behavior?: string } | null)?.behavior === 'instant'),
        scrollIntoViewCalls: state.__nativeScrollIntoViewCalls.filter((call) => call.targetId === 'parent-exchange'),
        scrollEvents: state.__nativeViewportScrollEvents,
      }
    })
    const replied = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollTop)
    assert.notEqual(replied, filteredScrollTop, JSON.stringify(replyGeometry))
    assert.equal(replyGeometry.calls.length, 1)
    assert.equal((replyGeometry.calls[0]?.options as { behavior?: string })?.behavior, 'instant')
    assert.ok(Number((replyGeometry.calls[0]?.options as { top?: number })?.top) > 0)
    assert.ok(Number(replyGeometry.calls[0]?.beforeTargetTop) > Number(replyGeometry.viewportTop) + Number(replyGeometry.clientHeight), JSON.stringify(replyGeometry))
    assert.equal(replyGeometry.scrollIntoViewCalls.length, 0)
    assert.ok(Math.abs(Number(replyGeometry.calls[0]?.afterTargetTop) - Number(replyGeometry.viewportTop)) < 1, JSON.stringify(replyGeometry))
    assert.ok(replyGeometry.scrollEvents.length > missingTargetState.scrollEventCount)
    console.log('Mounted reply scroll evidence:', JSON.stringify(replyGeometry))

    const stableScrollTop = replyGeometry.scrollTop
    await update(snapshot(view, { query: '', theme: 'light', scrollIntent: { id: 'reply-wait-1', kind: 'reply', exchangeId: 'parent-exchange' } }))
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    const stableGeometry = await page.evaluate(() => ({
      scrollTop: document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop,
      targetTop: document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')?.getBoundingClientRect().top,
      calls: (window as unknown as { __nativeScrollToCalls: Array<Record<string, unknown>> }).__nativeScrollToCalls.filter((call) => call.targetId === 'parent-exchange' && (call.options as { behavior?: string } | null)?.behavior === 'instant').length,
    }))
    assert.equal(stableGeometry.calls, 1)
    assert.equal(stableGeometry.scrollTop, stableScrollTop)
    assert.ok(Math.abs(Number(stableGeometry.targetTop) - Number(replyGeometry.targetTop)) < 1)

    await update(snapshot(view, { query: 'Variant B search context', scrollIntent: null }))
    const searchRows = await page.evaluate(() => {
      const exchanges = Array.from(document.querySelectorAll<HTMLElement>('[data-native-exchange]'))
      return exchanges.map((exchange) => ({
        id: exchange.dataset.nativeExchange,
        prompts: exchange.querySelectorAll('[data-native-prompt-exchange="true"]').length,
        assistants: exchange.querySelectorAll('[data-native-assistant-exchange="true"]').length,
      }))
    })
    assert.deepEqual(searchRows, [{ id: 'turn-1', prompts: 1, assistants: 1 }])
  } finally {
    await browser.close()
  }
})

test('mounted React short reply scroll reaches the bounded near-bottom position', async () => {
  const view = makeView()
  const parent = structuredClone(view.exchanges[0]!)
  parent.id = 'parent-exchange'
  parent.turnId = 'parent-turn'
  parent.index = 1
  parent.user.id = 'parent-user'
  parent.user.text = 'Parent reply target'
  parent.responses.forEach((response, index) => {
    response.id = `parent-response-${index}`
    response.blocks = [{ kind: 'text', text: `Parent response ${index}` } as never]
  })
  view.exchanges[0]!.user.replyThread = { replyToTurnId: 'parent-turn', replySnippet: 'Parent reply target' }
  Object.assign(view, { exchanges: [...view.exchanges, parent] })

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 640, height: 420 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:420px;width:640px}</style><div id="root"></div>`)
    await page.evaluate(() => {
      const state = window as unknown as {
        __shortReplyScrollCalls: Array<Record<string, unknown>>
        __shortReplyScrollIntoViewCalls: Array<Record<string, unknown>>
        __shortReplyScrollTargetId: string
        __shortReplyScrollEvents: number[]
        __shortReplyGeometrySample: { scrollTop: number; targetContentTop: number; maxScroll: number; stableFrames: number } | null
      }
      state.__shortReplyScrollCalls = []
      state.__shortReplyScrollIntoViewCalls = []
      state.__shortReplyScrollTargetId = 'parent-exchange'
      state.__shortReplyScrollEvents = []
      state.__shortReplyGeometrySample = null
      const nativeScrollIntoView = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = function (options?: ScrollIntoViewOptions) {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        const target = this as HTMLElement
        const record: Record<string, unknown> = {
          targetId: target.dataset.nativeExchange ?? '',
          options: options ? { block: options.block, behavior: options.behavior } : null,
          computedScrollBehavior: viewport ? getComputedStyle(viewport).scrollBehavior : '',
          beforeScrollTop: viewport?.scrollTop ?? -1,
          beforeTargetTop: target.getBoundingClientRect().top,
        }
        state.__shortReplyScrollIntoViewCalls.push(record)
        nativeScrollIntoView.call(this, options)
        record.afterScrollTop = viewport?.scrollTop ?? -1
        record.afterTargetTop = target.getBoundingClientRect().top
      }
      const nativeScrollTo = Element.prototype.scrollTo
      Element.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
        const viewport = this as HTMLElement
        const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
        const record: Record<string, unknown> = {
          targetId: state.__shortReplyScrollTargetId,
          options: typeof options === 'number' ? { left: options, top: y } : options ? { top: options.top, behavior: options.behavior } : null,
          computedScrollBehavior: getComputedStyle(viewport).scrollBehavior,
          beforeScrollTop: viewport.scrollTop,
          beforeTargetTop: target?.getBoundingClientRect().top ?? -1,
        }
        if (viewport.getAttribute('aria-label') === 'Conversation') state.__shortReplyScrollCalls.push(record)
        Reflect.apply(nativeScrollTo, this, typeof options === 'number' ? [options, y ?? 0] : [options ?? {}])
        record.afterScrollTop = viewport.scrollTop
        record.afterTargetTop = target?.getBoundingClientRect().top ?? -1
      }
      document.addEventListener('scroll', (event) => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        if (viewport && event.target === viewport) state.__shortReplyScrollEvents.push(viewport.scrollTop)
      }, true)
    })
    await page.evaluate(() => {
      Object.defineProperty(document, 'fonts', { configurable: true, value: {
        ready: new Promise<void>((resolve) => { (window as unknown as { __resolveShortReplyFonts?: () => void }).__resolveShortReplyFonts = resolve }),
      } })
    })
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { query: '', scrollIntent: null }))
    await page.locator('[data-native-exchange="parent-exchange"]').waitFor()
    await page.evaluate(() => (window as unknown as { __resolveShortReplyFonts?: () => void }).__resolveShortReplyFonts?.())
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)

    const beforeReply = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')!
      const viewportTop = viewport.getBoundingClientRect().top
      return {
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
        maxScroll: viewport.scrollHeight - viewport.clientHeight,
        viewportTop,
        targetTop: target.getBoundingClientRect().top,
        targetBottom: target.getBoundingClientRect().bottom,
        targetContentTop: viewport.scrollTop + target.getBoundingClientRect().top - viewportTop,
        scrollBehavior: getComputedStyle(viewport).scrollBehavior,
      }
    })
    assert.equal(beforeReply.scrollTop, 0)
    assert.ok(beforeReply.maxScroll > 0 && beforeReply.maxScroll < beforeReply.clientHeight, JSON.stringify(beforeReply))
    assert.ok(beforeReply.targetTop > beforeReply.viewportTop && beforeReply.targetTop < beforeReply.viewportTop + beforeReply.clientHeight, JSON.stringify(beforeReply))
    assert.ok(beforeReply.targetBottom > beforeReply.viewportTop + beforeReply.clientHeight, JSON.stringify(beforeReply))
    assert.ok(beforeReply.targetContentTop > beforeReply.maxScroll, JSON.stringify(beforeReply))
    assert.equal(beforeReply.scrollBehavior, 'auto')
    assert.equal(await page.evaluate(() => (window as unknown as { __shortReplyScrollCalls: Array<Record<string, unknown>> }).__shortReplyScrollCalls.filter((call) => (call.options as { behavior?: string } | null)?.behavior === 'instant').length), 0)
    assert.equal(await page.evaluate(() => (window as unknown as { __shortReplyScrollIntoViewCalls: unknown[] }).__shortReplyScrollIntoViewCalls.length), 0)

    const replyIntent = { id: 'reply-short-1', kind: 'reply' as const, exchangeId: 'parent-exchange' }
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, { query: '__no_matching_exchange__', scrollIntent: replyIntent }))
    await page.waitForFunction(() => !document.querySelector('[data-native-exchange="parent-exchange"]'))
    const missingTarget = await page.evaluate(() => {
      const state = window as unknown as { __shortReplyScrollCalls: Array<Record<string, unknown>>; __shortReplyScrollIntoViewCalls: Array<Record<string, unknown>>; __shortReplyScrollEvents: number[] }
      return {
        targetMounted: Boolean(document.querySelector('[data-native-exchange="parent-exchange"]')),
        calls: state.__shortReplyScrollCalls.filter((call) => call.targetId === 'parent-exchange' && (call.options as { behavior?: string } | null)?.behavior === 'instant').length,
        scrollIntoViewCalls: state.__shortReplyScrollIntoViewCalls.filter((call) => call.targetId === 'parent-exchange').length,
        scrollEventCount: state.__shortReplyScrollEvents.length,
      }
    })
    assert.equal(missingTarget.targetMounted, false)
    assert.equal(missingTarget.calls, 0)

    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, { query: '', scrollIntent: replyIntent }))
    await page.locator('[data-native-exchange="parent-exchange"]').waitFor()
    await page.waitForFunction(() => {
      const state = window as unknown as { __shortReplyScrollCalls: Array<Record<string, unknown>> }
      return state.__shortReplyScrollCalls.filter((call) => call.targetId === 'parent-exchange' && (call.options as { behavior?: string } | null)?.behavior === 'instant').length === 1
    })
    await page.waitForFunction((scrollEventBaseline) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
      const state = window as unknown as {
        __shortReplyScrollCalls: Array<Record<string, unknown>>
        __shortReplyScrollIntoViewCalls: Array<Record<string, unknown>>
        __shortReplyScrollEvents: number[]
        __shortReplyGeometrySample: { scrollTop: number; targetContentTop: number; maxScroll: number; stableFrames: number } | null
      }
      if (!viewport || !target || state.__shortReplyScrollCalls.filter((call) => call.targetId === 'parent-exchange' && (call.options as { behavior?: string } | null)?.behavior === 'instant').length !== 1) return false
      const viewportTop = viewport.getBoundingClientRect().top
      const scrollTop = viewport.scrollTop
      const targetContentTop = scrollTop + target.getBoundingClientRect().top - viewportTop
      const maxScroll = viewport.scrollHeight - viewport.clientHeight
      const expectedScrollTop = Math.min(targetContentTop, maxScroll)
      const lastScrollEvent = state.__shortReplyScrollEvents.at(-1)
      const settled = state.__shortReplyScrollEvents.length > scrollEventBaseline &&
        lastScrollEvent !== undefined && Math.abs(lastScrollEvent - scrollTop) < 0.5 && Math.abs(scrollTop - expectedScrollTop) < 1
      const previous = state.__shortReplyGeometrySample
      const stableFrames = settled && previous && Math.abs(previous.scrollTop - scrollTop) < 0.5 &&
        Math.abs(previous.targetContentTop - targetContentTop) < 0.5 && Math.abs(previous.maxScroll - maxScroll) < 0.5
        ? previous.stableFrames + 1
        : 0
      state.__shortReplyGeometrySample = { scrollTop, targetContentTop, maxScroll, stableFrames }
      return settled && stableFrames >= 3
    }, missingTarget.scrollEventCount, { polling: 'raf', timeout: 5000 }).catch(async (error: unknown) => {
      const geometry = await page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
        const state = window as unknown as {
          __shortReplyScrollCalls: Array<Record<string, unknown>>
          __shortReplyScrollIntoViewCalls: Array<Record<string, unknown>>
          __shortReplyScrollEvents: number[]
          __shortReplyGeometrySample: unknown
        }
        return {
          scrollTop: viewport?.scrollTop,
          scrollHeight: viewport?.scrollHeight,
          clientHeight: viewport?.clientHeight,
          targetTop: target?.getBoundingClientRect().top,
          calls: state.__shortReplyScrollCalls,
          scrollIntoViewCalls: state.__shortReplyScrollIntoViewCalls,
          events: state.__shortReplyScrollEvents,
          sample: state.__shortReplyGeometrySample,
        }
      })
      throw new Error(`${String(error)} ${JSON.stringify({ missingTarget, geometry })}`)
    })

    const settledReply = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')!
      const state = window as unknown as { __shortReplyScrollCalls: Array<Record<string, unknown>>; __shortReplyScrollIntoViewCalls: Array<Record<string, unknown>>; __shortReplyScrollEvents: number[] }
      const viewportTop = viewport.getBoundingClientRect().top
      const targetContentTop = viewport.scrollTop + target.getBoundingClientRect().top - viewportTop
      const maxScroll = viewport.scrollHeight - viewport.clientHeight
      return {
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
        maxScroll,
        targetTop: target.getBoundingClientRect().top,
        targetContentTop,
        expectedScrollTop: Math.min(targetContentTop, maxScroll),
        scrollBehavior: getComputedStyle(viewport).scrollBehavior,
        calls: state.__shortReplyScrollCalls.filter((call) => call.targetId === 'parent-exchange' && (call.options as { behavior?: string } | null)?.behavior === 'instant'),
        scrollIntoViewCalls: state.__shortReplyScrollIntoViewCalls.filter((call) => call.targetId === 'parent-exchange'),
        scrollEvents: state.__shortReplyScrollEvents,
      }
    })
    assert.ok(Math.abs(settledReply.scrollTop - settledReply.expectedScrollTop) < 1, JSON.stringify(settledReply))
    assert.equal((settledReply.calls[0]?.options as { behavior?: string })?.behavior, 'instant')
    assert.ok(Number((settledReply.calls[0]?.options as { top?: number })?.top) > 0)
    assert.equal(settledReply.scrollBehavior, beforeReply.scrollBehavior)
    assert.equal(settledReply.calls.length, 1)
    assert.equal(settledReply.scrollIntoViewCalls.length, 0)
    console.log('Mounted short reply scroll evidence:', JSON.stringify({ beforeReply, missingTarget, settledReply }))

    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, { query: '', theme: 'light', scrollIntent: replyIntent }))
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    const afterSnapshot = await page.evaluate(() => ({
      scrollTop: document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop,
      calls: (window as unknown as { __shortReplyScrollCalls: Array<Record<string, unknown>> }).__shortReplyScrollCalls.filter((call) => call.targetId === 'parent-exchange' && (call.options as { behavior?: string } | null)?.behavior === 'instant').length,
    }))
    assert.equal(afterSnapshot.scrollTop, settledReply.scrollTop)
    assert.equal(afterSnapshot.calls, 1)
  } finally {
    await browser.close()
  }
})

test('mounted shared reply anchor dispatches scoped jump under filtering and uses shared local fallback', async () => {
  const view = makeView()
  const source = view.exchanges[0]!
  source.id = 'reply-source-exchange'
  source.turnId = 'reply-source-turn'
  source.index = 0
  source.user.id = 'reply-source-user'
  source.user.text = 'child-reply-sentinel '.repeat(120)
  source.user.replyThread = { replyToTurnId: 'parent-turn', replySnippet: 'known parent destination' }
  source.responses.forEach((response, index) => {
    response.id = `reply-source-response-${index}`
    response.blocks = [{ kind: 'text', text: `Child response ${index}` } as never]
  })
  const parent = structuredClone(source)
  parent.id = 'parent-exchange'
  parent.turnId = 'parent-turn'
  parent.index = 1
  parent.user.id = 'parent-user'
  parent.user.text = 'parent-target-content '.repeat(100)
  parent.user.replyThread = null
  parent.responses.forEach((response, index) => {
    response.id = `parent-response-${index}`
    response.blocks = [{ kind: 'text', text: `Parent response ${index}` } as never]
  })
  view.exchanges = [source, parent]

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 640, height: 420 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:420px;width:640px}</style><div id="root"></div>`)
    await page.evaluate(() => {
      const state = window as unknown as {
        __replyBridgeScrollCalls: Array<Record<string, unknown>>
        __replyBridgeScrollIntoViewCalls: Array<Record<string, unknown>>
      }
      state.__replyBridgeScrollCalls = []
      state.__replyBridgeScrollIntoViewCalls = []
      const nativeScrollTo = Element.prototype.scrollTo
      Element.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
        const viewport = this as HTMLElement
        if (viewport.getAttribute('aria-label') === 'Conversation') {
          const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
          state.__replyBridgeScrollCalls.push({
            options: typeof options === 'number' ? { left: options, top: y } : options ? { top: options.top, behavior: options.behavior } : null,
            targetTop: target?.getBoundingClientRect().top ?? -1,
          })
        }
        Reflect.apply(nativeScrollTo, this, typeof options === 'number' ? [options, y ?? 0] : [options ?? {}])
      }
      const nativeScrollIntoView = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = function (options?: ScrollIntoViewOptions) {
        state.__replyBridgeScrollIntoViewCalls.push({ target: (this as HTMLElement).dataset.nativeExchange ?? '' })
        nativeScrollIntoView.call(this, options)
      }
    })
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    const update = (next: ReturnType<typeof snapshot>) => page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, next)
    const replyAnchor = page.getByRole('button', { name: /Replying to.*known parent destination/ })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { supportedActions: ['jump-to-reply'], query: 'child-reply-sentinel' }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    assert.equal(await page.locator('[data-native-exchange="parent-exchange"]').count(), 0)
    assert.equal(await replyAnchor.count(), 1)
    await replyAnchor.click()
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length === 1)
    const jumpRequest = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions[0])))
    assert.deepEqual(jumpRequest, {
      kind: 'jump-to-reply', ...scope, exchangeId: source.id,
      target: { kind: 'user', userId: source.user.id },
    })

    await update(snapshot(view, { supportedActions: ['jump-to-reply'], query: '', scrollIntent: { id: 'host-reply-reveal', kind: 'reply', exchangeId: parent.id } }))
    try {
      await page.waitForFunction(() => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
        return Boolean(viewport && target && Math.abs(target.getBoundingClientRect().top - viewport.getBoundingClientRect().top) < 1)
      })
    } catch (error) {
      const scrollState = await page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
        const item = target?.closest<HTMLElement>('[data-message-id]')
        const state = window as unknown as { __replyBridgeScrollCalls: Array<Record<string, unknown>> }
        return {
          viewportTop: viewport?.getBoundingClientRect().top ?? null,
          targetTop: target?.getBoundingClientRect().top ?? null,
          scrollTop: viewport?.scrollTop ?? null,
          scrollHeight: viewport?.scrollHeight ?? null,
          clientHeight: viewport?.clientHeight ?? null,
          itemId: item?.dataset.messageId ?? null,
          scrollCalls: state.__replyBridgeScrollCalls,
        }
      })
      throw new Error(`${error instanceof Error ? error.message : String(error)}; reply scroll state: ${JSON.stringify(scrollState)}`)
    }
    await page.waitForTimeout(50)
    const revealed = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')!
      const targetTop = target.getBoundingClientRect().top
      const viewportTop = viewport.getBoundingClientRect().top
      const targetContentTop = viewport.scrollTop + targetTop - viewportTop
      const maxScroll = viewport.scrollHeight - viewport.clientHeight
      const state = window as unknown as { __replyBridgeScrollCalls: Array<Record<string, unknown>>; __replyBridgeScrollIntoViewCalls: Array<Record<string, unknown>> }
      return { scrollTop: viewport.scrollTop, targetTop, targetContentTop, maxScroll, expectedScrollTop: Math.min(targetContentTop, maxScroll), calls: state.__replyBridgeScrollCalls, scrollIntoViewCalls: state.__replyBridgeScrollIntoViewCalls }
    })
    assert.ok(Math.abs(revealed.scrollTop - revealed.expectedScrollTop) < 1, JSON.stringify(revealed))
    assert.equal(revealed.calls.filter((call) => (call.options as { behavior?: string } | null)?.behavior === 'instant').length, 1)
    assert.deepEqual(revealed.scrollIntoViewCalls, [])

    await update(snapshot(view, { supportedActions: [], query: 'child-reply-sentinel', scrollIntent: null }))
    await page.waitForFunction(() => !document.querySelector('[data-native-exchange="parent-exchange"]'))
    await replyAnchor.click()
    assert.equal((await page.getByRole('status').textContent())?.trim(), 'Clear search to view this reply')
    assert.equal(await page.evaluate(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length), 1)

    await update(snapshot(view, { supportedActions: [], query: '', scrollIntent: { id: 'local-reply-top', kind: 'restore', scrollTop: 0 } }))
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop === 0)
    const callsBeforeLocalJump = await page.evaluate(() => (window as unknown as { __replyBridgeScrollCalls: unknown[] }).__replyBridgeScrollCalls.length)
    await replyAnchor.click()
    await page.waitForFunction((before) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
      const state = window as unknown as { __replyBridgeScrollCalls: unknown[] }
      if (!viewport || !target || state.__replyBridgeScrollCalls.length <= before) return false
      const targetContentTop = viewport.scrollTop + target.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      const maxScroll = viewport.scrollHeight - viewport.clientHeight
      return Math.abs(viewport.scrollTop - Math.min(targetContentTop, maxScroll)) < 1
    }, callsBeforeLocalJump, { timeout: 5000 }).catch(async (error: unknown) => {
      const geometry = await page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')
        const state = window as unknown as { __replyBridgeScrollCalls: unknown[]; __replyBridgeScrollIntoViewCalls: unknown[]; __nativeTranscriptActions: unknown[] }
        return { scrollTop: viewport?.scrollTop, targetTop: target?.getBoundingClientRect().top, calls: state.__replyBridgeScrollCalls, scrollIntoViewCalls: state.__replyBridgeScrollIntoViewCalls, actions: state.__nativeTranscriptActions, notice: document.querySelector('[role="status"]')?.textContent }
      })
      throw new Error(`${String(error)} ${JSON.stringify({ callsBeforeLocalJump, geometry })}`)
    })
    const localFallback = await page.evaluate((before) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const target = document.querySelector<HTMLElement>('[data-native-exchange="parent-exchange"]')!
      const targetContentTop = viewport.scrollTop + target.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      const maxScroll = viewport.scrollHeight - viewport.clientHeight
      const state = window as unknown as { __replyBridgeScrollCalls: Array<Record<string, unknown>> }
      return { scrollTop: viewport.scrollTop, expectedScrollTop: Math.min(targetContentTop, maxScroll), calls: state.__replyBridgeScrollCalls.slice(before) }
    }, callsBeforeLocalJump)
    assert.ok(Math.abs(localFallback.scrollTop - localFallback.expectedScrollTop) < 1, JSON.stringify(localFallback))
    assert.equal(localFallback.calls.length, 1)
    assert.equal((localFallback.calls[0]?.options as { behavior?: string } | null)?.behavior, 'instant')
    assert.equal(await page.getByRole('status').count(), 0)
    assert.equal(await page.evaluate(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length), 1)
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __replyBridgeScrollIntoViewCalls: unknown[] }).__replyBridgeScrollIntoViewCalls), [])

    await page.evaluate(() => { (window as unknown as { __nativeTranscriptPending: boolean }).__nativeTranscriptPending = true })
    await update(snapshot(view, { supportedActions: ['jump-to-reply'], query: 'child-reply-sentinel', scrollIntent: null }))
    await replyAnchor.click()
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length === 2)
    await update(snapshot(view, { supportedActions: [], query: 'child-reply-sentinel', scrollIntent: null }))
    await page.evaluate(() => {
      const state = window as unknown as { __nativeTranscriptPending: boolean; __resolveNativeTranscriptAction?: (result: NativeTranscriptActionResult) => void }
      state.__nativeTranscriptPending = false
      state.__resolveNativeTranscriptAction?.({ ok: true })
    })
    await page.waitForTimeout(30)
    assert.equal(await page.getByRole('status').count(), 0)

    await update(snapshot(view, { supportedActions: ['jump-to-reply'], query: 'child-reply-sentinel', scrollIntent: null }))
    await page.evaluate(() => { (window as unknown as { __nativeTranscriptPending: boolean }).__nativeTranscriptPending = true })
    await replyAnchor.click()
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length === 3)
    const sourceOnlyView = structuredClone(view)
    sourceOnlyView.exchanges = [sourceOnlyView.exchanges[0]!]
    await update(snapshot(sourceOnlyView, { supportedActions: ['jump-to-reply'], query: 'child-reply-sentinel', scrollIntent: null }))
    await page.evaluate(() => {
      const state = window as unknown as { __nativeTranscriptPending: boolean; __resolveNativeTranscriptAction?: (result: NativeTranscriptActionResult) => void }
      state.__nativeTranscriptPending = false
      state.__resolveNativeTranscriptAction?.({ ok: true })
    })
    await page.waitForTimeout(30)
    assert.equal(await page.getByRole('status').count(), 0)
    await replyAnchor.click()
    assert.equal((await page.getByRole('status').textContent())?.trim(), 'Reply unavailable')
    assert.equal(await page.evaluate(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length), 3)
  } finally {
    await browser.close()
  }
})

test('mounted settled transcript exposes an accessible themed jump-to-latest control and follows later growth', async () => {
  const view = makeView()
  const response = view.exchanges[0]!.responses[0]!
  response.status = 'completed'
  let transcript = Array.from({ length: 45 }, (_, index) => 'Settled paragraph ' + index + ': transcript history remains available above the latest message.').join('\n\n')
  response.blocks = [{ kind: 'text', text: transcript } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent('<style>' + css + ' html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>')
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { theme: 'light' }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)

    const button = page.getByRole('button', { name: 'Jump to latest message' })
    await button.waitFor({ state: 'visible' })
    assert.equal(await button.getAttribute('type'), 'button')
    assert.ok((await button.getAttribute('class'))?.includes('bg-(--surface-elevated)'))
    assert.ok((await button.getAttribute('class'))?.includes('text-(--muted)'))
    assert.equal(await page.locator('[data-slot="message-scroller"]').getAttribute('data-theme'), 'light')
    assert.ok(await page.locator('[aria-label="Conversation"]').evaluate((element) => {
      const viewport = element as HTMLElement
      return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 24
    }))

    await button.click()
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
    await page.waitForFunction(() => !document.querySelector('[aria-label="Jump to latest message"]'))

    const previousHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nSettled follow-up growth: ' + Array.from({ length: 8 }, (_, index) => 'additional content ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, { theme: 'light' }))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    }, previousHeight)
  } finally {
    await browser.close()
  }
})

test('mounted streaming jump resumes follow, preserves later scroll-away intent, and resets on scope change', async () => {
  const view = makeView()
  const response = view.exchanges[0]!.responses[0]!
  response.status = 'streaming'
  let transcript = Array.from({ length: 45 }, (_, index) => 'Streaming paragraph ' + index + ': current response content remains scrollable.').join('\n\n')
  response.blocks = [{ kind: 'text', text: transcript } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent('<style>' + css + ' html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>')
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { theme: 'dark' }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)

    const button = page.getByRole('button', { name: 'Jump to latest message' })
    await button.waitFor({ state: 'visible' })
    assert.equal(await page.locator('[data-slot="message-scroller"]').getAttribute('data-theme'), 'dark')
    await button.click()
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })

    let previousHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nStreaming chunk after jump: ' + Array.from({ length: 12 }, (_, index) => 'new chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, { theme: 'dark' }))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    }, previousHeight)

    await page.mouse.move(190, 420)
    await page.mouse.wheel(0, -500)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 24)
    })
    const scrolledAway = await page.locator('[aria-label="Conversation"]').evaluate((element) => {
      const viewport = element as HTMLElement
      return { scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight }
    })
    assert.ok(await button.isVisible())

    transcript += '\n\nStreaming chunk while reading history: ' + Array.from({ length: 12 }, (_, index) => 'later chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, { theme: 'dark' }))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height)
    }, scrolledAway.scrollHeight)
    const afterAwayGrowth = await page.locator('[aria-label="Conversation"]').evaluate((element) => {
      const viewport = element as HTMLElement
      return { scrollTop: viewport.scrollTop, distanceFromBottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight }
    })
    assert.equal(afterAwayGrowth.scrollTop, scrolledAway.scrollTop)
    assert.ok(afterAwayGrowth.distanceFromBottom > 24)
    assert.ok(await button.isVisible())

    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, { theme: 'light', conversationId: 'conversation-2', mountNonce: 'mount-2', focusNonce: 'focus-2' }))
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      const scroller = document.querySelector<HTMLElement>('[data-slot="message-scroller"]')
      return Boolean(viewport && viewport.scrollTop === 0 && scroller?.dataset.theme === 'light')
    })
    await page.getByRole('button', { name: 'Jump to latest message' }).waitFor({ state: 'visible' })

    previousHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nNew scope content: ' + Array.from({ length: 8 }, (_, index) => 'new conversation ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, { theme: 'light', conversationId: 'conversation-2', mountNonce: 'mount-2', focusNonce: 'focus-2' }))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollTop === 0)
    }, previousHeight)
  } finally {
    await browser.close()
  }
})

test('mounted wheel and held-text gestures preserve scroll-away and manual-bottom follow intent', async () => {
  const view = makeView()
  const response = view.exchanges[0]!.responses[0]!
  response.status = 'streaming'
  let transcript = Array.from({ length: 45 }, (_, index) => 'Wheel history ' + index + ': use a real gesture to return to the latest response.').join('\n\n')
  response.blocks = [{ kind: 'text', text: transcript } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent('<style>' + css + ' html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>')
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)

    const button = page.getByRole('button', { name: 'Jump to latest message' })
    await button.waitFor({ state: 'visible' })
    await page.mouse.move(190, 420)
    await page.mouse.wheel(0, 5000)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
    await button.waitFor({ state: 'hidden' })

    const grow = async (label: string) => {
      const previousHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
      transcript += '\n\n' + label + ': ' + Array.from({ length: 14 }, (_, index) => 'stream growth ' + index).join(' ')
      response.blocks = [{ kind: 'text', text: transcript } as never]
      await page.evaluate((value) => {
        (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
      }, snapshot(view))
      await page.waitForFunction((height) => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
      }, previousHeight)
    }

    await grow('Growth after manual return')
    await page.mouse.wheel(0, 500)
    await grow('Growth after downward wheel at bottom')
    await page.mouse.wheel(500, 0)
    await grow('Growth after horizontal wheel at bottom')

    const holdTarget = await page.evaluate(() => {
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('Wheel history 44')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      throw new Error('held-text target not found')
    })
    await page.mouse.move(holdTarget.x, holdTarget.y)
    await page.mouse.down()
    await page.mouse.wheel(0, -500)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 24)
    })
    await prepareOutsidePointerRelease(page, holdTarget)
    await page.mouse.up()
    await removeOutsidePointerRelease(page)
    const away = await page.locator('[aria-label="Conversation"]').evaluate((element) => {
      const viewport = element as HTMLElement
      return { scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight }
    })
    transcript += '\n\nGrowth after scroll-away during a text hold: ' + Array.from({ length: 12 }, (_, index) => 'away chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height)
    }, away.scrollHeight)
    const afterAwayGrowth = await page.locator('[aria-label="Conversation"]').evaluate((element) => {
      const viewport = element as HTMLElement
      return { scrollTop: viewport.scrollTop, distanceFromBottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight }
    })
    assert.equal(afterAwayGrowth.scrollTop, away.scrollTop)
    assert.ok(afterAwayGrowth.distanceFromBottom > 24)

    await page.mouse.wheel(0, 5000)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
    await grow('Growth after manual bottom following a text hold')
    await button.waitFor({ state: 'hidden' })
  } finally {
    await browser.close()
  }
})

test('mounted browser pointer text-selection hold freezes the target before selection and pauses follow through growth', async () => {
  const view = makeView()
  const response = view.exchanges[0]!.responses[0]!
  response.status = 'streaming'
  let transcript = Array.from({ length: 36 }, (_, index) => 'Selection history ' + index + ': preserve the active reading position.').join('\n\n')
  transcript += '\n\nThe target glyph stood at the latest response.\n\nA stable trailing paragraph keeps the selection target away from the streaming insertion point.'
  response.blocks = [{ kind: 'text', text: transcript } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent('<style>' + css + ' html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>')
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { scrollIntent: { id: 'selection-follow', kind: 'initial-end' } }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
    await settleInitialTranscriptLayout(page)

    const start = await page.evaluate(() => {
      const root = document.querySelector('[data-native-assistant-exchange]')
      if (!root) throw new Error('assistant transcript not found')
      const target = 'stood'
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf(target)
        if (offset < 0) continue
        const first = document.createRange()
        first.setStart(node, offset)
        first.setEnd(node, offset + 1)
        const word = document.createRange()
        word.setStart(node, offset)
        word.setEnd(node, offset + target.length)
        const firstRect = first.getBoundingClientRect()
        const wordRect = word.getBoundingClientRect()
        return { x: firstRect.left + firstRect.width / 2, y: firstRect.top + firstRect.height / 2, endX: wordRect.right - 1, glyphY: wordRect.y }
      }
      throw new Error('selection glyph not found')
    })
    await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      viewport.addEventListener('pointerdown', (event) => {
        ;(window as unknown as { __selectionPointerDownTrusted: boolean }).__selectionPointerDownTrusted = event.isTrusted
      }, { capture: true, once: true })
    })
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    assert.equal(await page.evaluate(() => (window as unknown as { __selectionPointerDownTrusted?: boolean }).__selectionPointerDownTrusted), true)
    const previousHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    const heldBeforeGrowth = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('stood')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 'stood'.length)
        return { scrollTop: viewport.scrollTop, clientWidth: viewport.clientWidth, glyphY: range.getBoundingClientRect().y, word: node.data.slice(offset, offset + 'stood'.length), collapsed: window.getSelection()?.isCollapsed ?? true }
      }
      throw new Error('selection glyph not found')
    })
    assert.equal(heldBeforeGrowth.word, 'stood')
    assert.ok(Math.abs(heldBeforeGrowth.glyphY - start.glyphY) <= 1)
    assert.ok(heldBeforeGrowth.collapsed)
    await page.waitForTimeout(100)
    transcript += '\n\nStream growth while the pointer is still held: ' + Array.from({ length: 16 }, (_, index) => 'recognition interval ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height)
    }, previousHeight)
    await page.waitForTimeout(650)
    const heldAfterGrowth = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('stood')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 'stood'.length)
        return { scrollTop: viewport.scrollTop, clientWidth: viewport.clientWidth, glyphY: range.getBoundingClientRect().y, collapsed: window.getSelection()?.isCollapsed ?? true }
      }
      throw new Error('selection glyph not found')
    })
    assert.equal(heldAfterGrowth.scrollTop, heldBeforeGrowth.scrollTop)
    assert.ok(
      Math.abs(heldAfterGrowth.glyphY - heldBeforeGrowth.glyphY) <= 1,
      `glyph moved ${heldBeforeGrowth.glyphY} -> ${heldAfterGrowth.glyphY} at scrollTop ${heldBeforeGrowth.scrollTop} -> ${heldAfterGrowth.scrollTop} and width ${heldBeforeGrowth.clientWidth} -> ${heldAfterGrowth.clientWidth}`,
    )
    assert.ok(heldAfterGrowth.collapsed)

    await page.mouse.move(start.endX, start.y, { steps: 6 })
    await page.waitForFunction(() => {
      const selection = window.getSelection()
      return Boolean(selection && !selection.isCollapsed && selection.toString().trim() === 'stood')
    })
    await prepareOutsidePointerRelease(page, { x: start.endX, y: start.y })
    await observeNextPointerUpOutsideViewport(page)
    await page.mouse.up()
    assert.equal(await page.evaluate(() => (window as unknown as { __testPointerUpOutsideViewport?: boolean }).__testPointerUpOutsideViewport), true)
    await removeOutsidePointerRelease(page)
    await page.waitForTimeout(20)
    const before = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      return {
        scrollTop: viewport.scrollTop,
        distanceFromBottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
        selectedText: window.getSelection()?.toString() ?? '',
      }
    })
    assert.ok(before.distanceFromBottom > 24)
    assert.equal(before.selectedText.trim(), 'stood')

    const selectedHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nStream growth after text selection: ' + Array.from({ length: 16 }, (_, index) => 'new output ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction(({ height, scrollTop, selectedText }) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(
        viewport && viewport.scrollHeight > height && viewport.scrollTop === scrollTop &&
        window.getSelection()?.toString() === selectedText &&
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 24,
      )
    }, { height: selectedHeight, scrollTop: before.scrollTop, selectedText: before.selectedText })
  } finally {
    await browser.close()
  }
})

test('mounted short text taps restore follow and interactive links do not start a selection hold', async () => {
  const view = makeView()
  const response = view.exchanges[0]!.responses[0]!
  response.status = 'streaming'
  let transcript = Array.from({ length: 36 }, (_, index) => 'Tap history ' + index + ': keep the latest response in view.').join('\n\n')
  transcript += '\n\nOrdinary tap target and [interactive link](https://example.test).'
  response.blocks = [{ kind: 'text', text: transcript } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent('<style>' + css + ' html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>')
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { scrollIntent: { id: 'tap-follow', kind: 'initial-end' } }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
    await settleInitialTranscriptLayout(page)

    const target = await page.evaluate(() => {
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('Ordinary tap target')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      throw new Error('tap target not found')
    })
    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    const beforeHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nGrowth during an ordinary tap hold: ' + Array.from({ length: 12 }, (_, index) => 'tap chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height)
    }, beforeHeight)
    const held = await page.locator('[aria-label="Conversation"]').evaluate((element) => {
      const viewport = element as HTMLElement
      return { scrollTop: viewport.scrollTop, distanceFromBottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight }
    })
    assert.ok(held.distanceFromBottom > 24)
    await prepareOutsidePointerRelease(page, target)
    await observeNextPointerUpOutsideViewport(page)
    await page.mouse.up()
    assert.equal(await page.evaluate(() => (window as unknown as { __testPointerUpOutsideViewport?: boolean }).__testPointerUpOutsideViewport), true)
    await removeOutsidePointerRelease(page)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })

    const cancelTarget = await page.evaluate(() => {
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('Ordinary tap target')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      throw new Error('cancel target not found')
    })
    await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      viewport.addEventListener('pointerdown', (event) => {
        ;(window as unknown as { __cancelledPointerId: number }).__cancelledPointerId = event.pointerId
      }, { capture: true, once: true })
    })
    await page.mouse.move(cancelTarget.x, cancelTarget.y)
    await page.mouse.down()
    await prepareOutsidePointerRelease(page, cancelTarget)
    await page.evaluate(() => {
      const pointerId = (window as unknown as { __cancelledPointerId?: number }).__cancelledPointerId
      if (pointerId === undefined) throw new Error('pointer id not captured')
      const target = document.querySelector<HTMLElement>('[data-test-outside-pointer-release]')
      if (!target) throw new Error('outside pointer release target not found')
      target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId, pointerType: 'mouse', isPrimary: true }))
    })
    await page.mouse.up()
    await removeOutsidePointerRelease(page)
    const cancelledHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nGrowth after pointer cancellation: ' + Array.from({ length: 12 }, (_, index) => 'pointer cancel chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    }, cancelledHeight)

    const link = page.getByRole('link', { name: 'interactive link' })
    const linkBox = await link.boundingBox()
    assert.ok(linkBox)
    await page.mouse.move(linkBox!.x + linkBox!.width / 2, linkBox!.y + linkBox!.height / 2)
    await page.mouse.down()
    const linkHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nGrowth while an interactive link is pressed: ' + Array.from({ length: 12 }, (_, index) => 'link chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    }, linkHeight)
    await page.mouse.up()
  } finally {
    await browser.close()
  }
})

test('mounted duplicate pointer and touch delivery keeps the hold until both channels finish', async () => {
  const view = makeView()
  const response = view.exchanges[0]!.responses[0]!
  response.status = 'streaming'
  let transcript = Array.from({ length: 36 }, (_, index) => 'Duplicate history ' + index + ': keep the latest response visible.').join('\n\n')
  transcript += '\n\nThe target glyph stood at the latest response.\n\nA stable trailing paragraph remains after the held glyph.'
  response.blocks = [{ kind: 'text', text: transcript } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent('<style>' + css + ' html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>')
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { scrollIntent: { id: 'duplicate-follow', kind: 'initial-end' } }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
    await settleInitialTranscriptLayout(page)

    const target = await page.evaluate(() => {
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('stood')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 5)
        const rect = range.getBoundingClientRect()
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, glyphY: rect.y, word: node.data.slice(offset, offset + 5), scrollTop: viewport.scrollTop }
      }
      throw new Error('target glyph not found')
    })
    assert.equal(target.word, 'stood')
    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    await page.evaluate(({ x, y }) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const target = document.elementFromPoint(x, y)
      if (!target) throw new Error('touch target not found')
      const touch = { identifier: 73, clientX: x, clientY: y }
      const event = new Event('touchstart', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', { value: [touch] })
      target.dispatchEvent(event)
      if (!viewport.contains(target)) throw new Error('touch target escaped transcript viewport')
    }, target)
    await page.mouse.up()

    const beforeHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nGrowth while the duplicate touch channel remains active: ' + Array.from({ length: 12 }, (_, index) => 'duplicate chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height)
    }, beforeHeight)
    const held = await page.locator('[aria-label="Conversation"]').evaluate((element) => {
      const viewport = element as HTMLElement
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('stood')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 5)
        return {
          glyphY: range.getBoundingClientRect().y,
          scrollTop: viewport.scrollTop,
          distanceFromBottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
          selectionCollapsed: window.getSelection()?.isCollapsed ?? true,
        }
      }
      throw new Error('held glyph not found')
    })
    assert.equal(held.selectionCollapsed, true)
    assert.equal(held.scrollTop, target.scrollTop)
    assert.ok(Math.abs(held.glyphY - target.glyphY) <= 1, `glyph moved ${target.glyphY} -> ${held.glyphY}`)
    assert.ok(held.distanceFromBottom > 24)

    await page.mouse.wheel(0, -200)
    await page.waitForFunction(() => Boolean(document.querySelector('[aria-label="Jump to latest message"]')))
    await page.getByRole('button', { name: 'Jump to latest message' }).click()
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
    await page.evaluate(({ x, y }) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const event = new Event('touchend', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', { value: [] })
      Object.defineProperty(event, 'changedTouches', { value: [{ identifier: 73, clientX: x, clientY: y }] })
      viewport.dispatchEvent(event)
    }, target)
    const finalHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nGrowth after Jump completes the pending hold: ' + Array.from({ length: 8 }, (_, index) => 'jump chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    }, finalHeight)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
  } finally {
    await browser.close()
  }
})

test('mounted touch hold freezes before selection, cancels cleanly, and cannot resume follow across scope cleanup', async () => {
  const view = makeView()
  const response = view.exchanges[0]!.responses[0]!
  response.status = 'streaming'
  let transcript = Array.from({ length: 36 }, (_, index) => 'Touch history ' + index + ': keep the reading position stable.').join('\n\n')
  transcript += '\n\nTouch hold target stood here.\n\nA stable trailing paragraph remains after the held glyph.'
  response.blocks = [{ kind: 'text', text: transcript } as never]
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
  try {
    const page = await context.newPage()
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><style>' + css + ' html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>')
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { scrollIntent: { id: 'touch-follow', kind: 'initial-end' } }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    })
    await settleInitialTranscriptLayout(page)
    const touch = await context.newCDPSession(page)
    const target = await page.evaluate(() => {
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('stood')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 'stood'.length)
        const rect = range.getBoundingClientRect()
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, glyphY: rect.y, word: node.data.slice(offset, offset + 'stood'.length), scrollTop: viewport.scrollTop, clientWidth: viewport.clientWidth }
      }
      throw new Error('touch target not found')
    })
    assert.equal(target.word, 'stood')
    await page.evaluate(() => {
      document.addEventListener('touchstart', (event) => {
        ;(window as unknown as { __selectionTouchStartTrusted: boolean }).__selectionTouchStartTrusted = event.isTrusted
      }, { capture: true, once: true })
    })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: target.x, y: target.y }] })
    assert.equal(await page.evaluate(() => (window as unknown as { __selectionTouchStartTrusted?: boolean }).__selectionTouchStartTrusted), true)
    const previousHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nTouch streaming growth during selection recognition: ' + Array.from({ length: 16 }, (_, index) => 'touch chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height)
    }, previousHeight)
    await page.waitForTimeout(100)
    const held = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('stood')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 'stood'.length)
        return { scrollTop: viewport.scrollTop, clientWidth: viewport.clientWidth, glyphY: range.getBoundingClientRect().y, word: node.data.slice(offset, offset + 'stood'.length), collapsed: window.getSelection()?.isCollapsed ?? true }
      }
      throw new Error('touch target not found')
    })
    assert.equal(held.word, 'stood')
    assert.equal(held.scrollTop, target.scrollTop)
    assert.ok(
      Math.abs(held.glyphY - target.glyphY) <= 1,
      `glyph moved ${target.glyphY} -> ${held.glyphY} at scrollTop ${target.scrollTop} -> ${held.scrollTop} and width ${target.clientWidth} -> ${held.clientWidth}`,
    )
    assert.ok(held.collapsed)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })

    const afterCancelHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nGrowth after touch cancellation: ' + Array.from({ length: 12 }, (_, index) => 'cancel chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24)
    }, afterCancelHeight)

    const secondTarget = await page.evaluate(() => {
      const root = document.querySelector('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf('stood')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      throw new Error('touch target not found')
    })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: secondTarget.x, y: secondTarget.y }] })
    const nextScope = { conversationId: 'conversation-touch-next', mountNonce: 'mount-touch-next', scrollIntent: { id: 'touch-scope-restore', kind: 'restore', scrollTop: 90 } }
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, nextScope))
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop === 90)
    const scopeHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nNew-scope growth while the old touch remains down: ' + Array.from({ length: 12 }, (_, index) => 'scope chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, nextScope))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollTop === 90)
    }, scopeHeight)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const finalHeight = await page.locator('[aria-label="Conversation"]').evaluate((element) => (element as HTMLElement).scrollHeight)
    transcript += '\n\nGrowth after old-scope touch release: ' + Array.from({ length: 8 }, (_, index) => 'final chunk ' + index).join(' ')
    response.blocks = [{ kind: 'text', text: transcript } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view, nextScope))
    await page.waitForFunction((height) => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(viewport && viewport.scrollHeight > height && viewport.scrollTop === 90)
    }, finalHeight)
    await touch.detach()
  } finally {
    await context.close()
    await browser.close()
  }
})

test('mounted streaming retains an intact assistant selection and reading position above bottom', async () => {
  const view = makeView()
  const exchange = view.exchanges[0]!
  const response = exchange.responses[0]!
  response.status = 'streaming'
  response.blocks = [{ kind: 'text', text: `stable-selection-anchor\n\n${Array.from({ length: 45 }, (_, index) => `Historical paragraph ${index}: transcript content remains above the reading position.`).join('\n\n')}` } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>`)
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { scrollIntent: { kind: 'restore', id: 'streaming-position', scrollTop: 90 } }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    const before = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      const root = document.querySelector<HTMLElement>('[data-native-assistant-exchange]')!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Text | null = null
      while (walker.nextNode()) {
        const candidate = walker.currentNode as Text
        if (candidate.data.includes('stable-selection-anchor')) { node = candidate; break }
      }
      if (!node) throw new Error('selection text node not found')
      const start = node.data.indexOf('stable-selection-anchor')
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + 'stable-selection-anchor'.length)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      ;(window as unknown as { __stableSelectionNode: Text }).__stableSelectionNode = node
      return { scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight }
    })
    assert.ok(before.scrollHeight > before.clientHeight)
    assert.ok(before.scrollTop > 0 && before.scrollTop < before.scrollHeight - before.clientHeight)
    await page.waitForTimeout(20)

    response.blocks = [{ kind: 'text', text: `${(response.blocks[0] as { text: string }).text}\n\nnew streamed chunk` } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction(() => {
      const state = window as unknown as { __stableSelectionNode: Text }
      const selection = window.getSelection()
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
      return Boolean(state.__stableSelectionNode?.isConnected && selection?.anchorNode === state.__stableSelectionNode && selection.toString() === 'stable-selection-anchor' && viewport?.scrollTop === 90)
    })
    const after = await page.evaluate(() => ({
      nodeConnected: (window as unknown as { __stableSelectionNode: Text }).__stableSelectionNode.isConnected,
      sameNode: window.getSelection()?.anchorNode === (window as unknown as { __stableSelectionNode: Text }).__stableSelectionNode,
      selectedText: window.getSelection()?.toString(),
      scrollTop: document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop,
    }))
    assert.deepEqual(after, { nodeConnected: true, sameNode: true, selectedText: 'stable-selection-anchor', scrollTop: 90 })
  } finally {
    await browser.close()
  }
})

test('mounted async Markdown highlighting preserves selection through a child-only node replacement', async () => {
  const view = makeView()
  const response = view.exchanges[0]!.responses[0]!
  response.status = 'completed'
  response.blocks = [{ kind: 'text', text: '```typescript\nconst anchor = "child-only-selection-target";\n```' } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>`)
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate(() => {
      const root = document.getElementById('root')!
      const observer = new MutationObserver(() => {
        const code = Array.from(document.querySelectorAll('pre code')).find((element) => element.textContent?.includes('child-only-selection-target'))
        if (!code) return
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const node = walker.currentNode as Text
          const start = node.data.indexOf('child-only-selection-target')
          if (start < 0) continue
          const range = document.createRange()
          range.setStart(node, start)
          range.setEnd(node, start + 'child-only-selection-target'.length)
          window.getSelection()?.removeAllRanges()
          window.getSelection()?.addRange(range)
          ;(window as unknown as { __highlighterOriginalNode: Text }).__highlighterOriginalNode = node
          observer.disconnect()
          return
        }
      })
      observer.observe(root, { childList: true, subtree: true, characterData: true })
    })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view))
    await page.waitForFunction(() => Boolean((window as unknown as { __highlighterOriginalNode?: Text }).__highlighterOriginalNode), undefined, { timeout: 8000 })
    await page.waitForFunction(() => {
      const node = (window as unknown as { __highlighterOriginalNode: Text }).__highlighterOriginalNode
      return !node.isConnected
    }, undefined, { timeout: 15000 })
    await page.waitForFunction(() => window.getSelection()?.toString() === 'child-only-selection-target', undefined, { timeout: 5000 })
    const restored = await page.evaluate(() => ({
      oldNodeDisconnected: !(window as unknown as { __highlighterOriginalNode: Text }).__highlighterOriginalNode.isConnected,
      selectedText: window.getSelection()?.toString(),
    }))
    assert.deepEqual(restored, { oldNodeDisconnected: true, selectedText: 'child-only-selection-target' })
    await page.mouse.click(385, 820)
    await page.waitForFunction(() => window.getSelection()?.isCollapsed === true)
    await page.evaluate(() => {
      const code = document.querySelector('pre code')
      code?.appendChild(document.createTextNode('later child-only update'))
    })
    await page.waitForTimeout(20)
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '')
  } finally {
    await browser.close()
  }
})

test('mounted trusted primary pointer drag alone dispatches keyboard dismissal', async () => {
  const view = makeView()
  view.exchanges[0]!.responses[0]!.blocks = [{ kind: 'text', text: Array.from({ length: 36 }, (_, index) => `Historical line ${index}: enough transcript content to scroll.`).join('\n\n') } as never]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>`)
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { scrollIntent: { kind: 'initial-end', id: 'pointer-initial' } }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    const actions = () => page.evaluate(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length)
    assert.equal(await actions(), 0)

    const update = (next: ReturnType<typeof snapshot>) => page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, next)
    await update(snapshot(view, { query: 'Historical', scrollIntent: null }))
    await update(snapshot(view, { query: '', scrollIntent: { kind: 'restore', id: 'pointer-restore', scrollTop: 40 } }))
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[aria-label="Conversation"]')?.scrollTop === 40)
    await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')!
      viewport.scrollTop = 160
      viewport.dispatchEvent(new Event('scroll'))
    })
    assert.equal(await actions(), 0)

    await page.mouse.move(380, 200)
    await page.mouse.down()
    await page.mouse.move(380, 232, { steps: 3 })
    await page.mouse.up()
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length === 1)
    const action = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions[0])))
    assert.deepEqual(action, { kind: 'keyboard-dismiss', ...scope, intent: 'user-drag' })
  } finally {
    await browser.close()
  }
})

test('mounted Draft controls are absent without native capability and dispatch when enabled', async () => {
  const skillDraft = { name: 'Search skill', description: 'Find useful sources', instructions: 'Search safely', confidence: 'high', detectedIntegrations: ['Gmail'], reason: 'Requested by the user' }
  const automationDraft = buildAutomationDraftFromTurn({ userText: 'Create a daily tech news digest email using Gmail' })
  const view = makeRealDraftView(skillDraft, automationDraft)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>`)
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    const update = (next: ReturnType<typeof snapshot>) => page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
    }, next)
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, snapshot(view, { supportedActions: ['copy', 'reply'] }))
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    assert.equal(await page.getByRole('button', { name: 'Review draft' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Create automation' }).count(), 0)
    assert.equal(await page.evaluate(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length), 0)

    const projected = snapshot(view, { supportedActions: ['open-draft'] })
    await update(projected)
    await page.getByRole('button', { name: 'Create automation' }).click()
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length === 1)
    const action = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions[0])))
    const automation = projected.view.exchanges.find((exchange) => exchange.turnId === 'automation-turn')!
    assert.deepEqual(action, {
      kind: 'open-draft', ...scope, exchangeId: automation.id,
      target: { kind: 'response', responseId: automation.responses[0]!.id }, toolKey: 'automation-tool-key',
    })
  } finally {
    await browser.close()
  }
})

test('mounted Sources panel opens at phone width and captures provider, file, and memory links', async () => {
  const view = makeSourcesView()
  const projected = makeSourcesSnapshot(view)
  const exchange = projected.view.exchanges[0]!
  const response = exchange.responses[0]!
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>`)
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, projected)
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    await page.getByRole('button', { name: 'Open sources' }).click()
    const panel = page.getByRole('dialog', { name: 'Sources' })
    const bounds = await panel.boundingBox()
    assert.ok(bounds)
    assert.ok(bounds.width > 340 && bounds.width <= 390, `unexpected phone panel width ${bounds.width}`)
    assert.ok(bounds.height <= 844)

    await panel.getByRole('link', { name: /Public reference/ }).click()
    await panel.getByRole('link', { name: /Known provider file/ }).click()
    await panel.getByRole('link', { name: /Project plan/ }).click()
    await panel.getByRole('link', { name: /Saved preference/ }).click()
    const actions = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions)))
    assert.deepEqual(actions, [
      { kind: 'open-source', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, sourceId: 'provider-url-source' },
      { kind: 'open-source', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, sourceId: 'provider-file-source' },
      { kind: 'open-citation', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, citationKey: '1' },
      { kind: 'open-citation', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, citationKey: '2' },
    ])
  } finally {
    await browser.close()
  }
})

test('mounted Generated UI remains read-only while Copy and Download stay bound to trusted origins', async () => {
  const data = { version: 1, kind: 'draft.text', title: '../../Sensitive: Draft', body: 'Generated draft body' }
  const projected = makeGeneratedUiSnapshot(data)
  const exchange = projected.view.exchanges[0]!
  const response = exchange.responses[0]!
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>`)
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, projected)
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).count(), 0)
    assert.equal(await page.locator('[data-native-assistant-exchange] input, [data-native-assistant-exchange] textarea').count(), 0)

    await page.getByRole('button', { name: 'Copy', exact: true }).click()
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length === 2)
    const actions = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions)))
    assert.equal(actions[0].kind, 'copy')
    assert.deepEqual(actions[0].target, { kind: 'response', responseId: response.id })
    assert.match(actions[0].text, /Generated draft body/)
    assert.equal(actions[1].kind, 'download-text')
    assert.deepEqual(actions[1].target, { kind: 'response', responseId: response.id })
    assert.equal(actions[1].filename, '-sensitive-draft.txt')
    assert.match(actions[1].text, /Generated draft body/)

    const matchingTextView = makeView()
    matchingTextView.exchanges[0]!.user.text = 'Matching text'
    matchingTextView.exchanges[0]!.responses[0]!.blocks = [{ kind: 'text', text: 'Matching text' } as never]
    await page.evaluate((value) => {
      (window as unknown as { __updateNativeTranscript: (snapshot: unknown) => void }).__updateNativeTranscript(value)
      ;(window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length = 0
    }, snapshot(matchingTextView, { supportedActions: ['copy', 'reply'] }))
    await page.getByRole('button', { name: 'Copy response', exact: true }).click()
    await page.getByRole('button', { name: 'Copy sent message as Markdown', exact: true }).click()
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length === 2)
    const matchingCopies = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions)))
    assert.equal(matchingCopies[0].text, 'Matching text')
    assert.deepEqual(matchingCopies[0].target, { kind: 'response', responseId: matchingTextView.exchanges[0]!.responses[0]!.id })
    assert.equal(matchingCopies[1].text, 'Matching text')
    assert.deepEqual(matchingCopies[1].target, { kind: 'user', userId: matchingTextView.exchanges[0]!.user.id })
  } finally {
    await browser.close()
  }
})

test('mounted protected and multiple media use honest fallback rows with scoped preview and Reply controls', async () => {
  const view = makeMediaView([
    output('protected-output', 'image', 'completed', 'https://private.example/protected.png'),
    output('generating-output', 'image', 'pending'),
    output('failed-output', 'image', 'failed'),
  ])
  const exchange = view.exchanges[0]!
  const protectedAsset: NativeTranscriptProjectionAsset = {
    handle: 'opaque_media_handle_000001', exchangeId: exchange.id, resourceId: 'protected-output',
    resourceKind: 'output', previewable: true, label: 'Generated image',
  }
  const projected = makeMediaSnapshot(view, [protectedAsset])
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const css = readFileSync('assets/shared-markdown.generated.css', 'utf8')
    await page.setContent(`<style>${css} html,body,#root{height:100%;margin:0} #root{height:844px;width:100%}</style><div id="root"></div>`)
    await page.addScriptTag({ content: await nativeTranscriptBrowserBundle() })
    await page.evaluate((value) => {
      (window as unknown as { __mountNativeTranscript: (snapshot: unknown) => void }).__mountNativeTranscript(value)
    }, projected)
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptReady: unknown[] }).__nativeTranscriptReady.length > 0)
    assert.equal(await page.locator('[data-native-media-result]').count(), 3)
    assert.equal(await page.locator('[data-native-media-preview="image"]').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Download', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Delete', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0)

    await page.getByRole('button', { name: 'Open native media preview' }).click()
    await page.getByRole('button', { name: 'Reply to generated media' }).click()
    await page.getByRole('button', { name: 'Reply to prompt' }).first().click()
    await page.waitForFunction(() => (window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions.length === 3)
    const actions = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __nativeTranscriptActions: unknown[] }).__nativeTranscriptActions)))
    assert.deepEqual(actions, [
      { kind: 'open-asset', ...scope, exchangeId: exchange.id, assetHandle: protectedAsset.handle },
      { kind: 'reply', ...scope, exchangeId: exchange.id, target: { kind: 'media', assetHandle: protectedAsset.handle } },
      { kind: 'reply', ...scope, exchangeId: exchange.id, target: { kind: 'user', userId: exchange.user.id } },
    ])
  } finally {
    await browser.close()
  }
})

test('pending Generated UI Download completion cannot leak across response selection, removal, scope change, or unmount', async () => {
  installDomShims()
  const view = makeView()
  for (const [index, response] of view.exchanges[0]!.responses.entries()) {
    response.status = 'completed'
    response.blocks = [generatedUiBlock({ version: 1, kind: 'draft.text', body: `Response ${index} draft` }, `part-${index}`)]
  }
  const actions: NativeTranscriptActionRequest[] = []
  const pending: Array<ReturnType<typeof deferred<NativeTranscriptActionResult>>> = []
  const onAction = async (request: NativeTranscriptActionRequest): Promise<NativeTranscriptActionResult> => {
    actions.push(request)
    if (request.kind !== 'download-text') return { ok: true }
    const next = deferred<NativeTranscriptActionResult>()
    pending.push(next)
    return next.promise
  }
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={snapshot(view, { supportedActions: ['copy', 'download-text', 'reply'] })} onAction={onAction} onReady={() => {}} />) })
  await settleSharedUi()

  const startPendingDownload = async () => {
    const callback = renderer.root.findByProps({ 'aria-label': 'Download' }).props.onClick as () => void
    await runAct(async () => { callback() })
    await settleSharedUi()
    return { pending: pending.at(-1)!, callback }
  }
  const finishRejected = async (item: ReturnType<typeof deferred<NativeTranscriptActionResult>>) => {
    item.resolve({ ok: false, error: 'action-failed' })
    await runAct(async () => { await item.promise })
    await settleSharedUi()
    assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0)
    assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0)
  }

  const selectedResponse = view.exchanges[0]!.responses[0]!
  const first = await startPendingDownload()
  await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Next response' }).props.onClick() })
  assert.equal(renderer.root.findByProps({ 'data-native-exchange': 'turn-1' }).props['data-native-response-id'], view.exchanges[0]!.responses[1]!.id)
  const invokedBeforeStaleCallback = actions.length
  await runAct(async () => { first.callback() })
  await settleSharedUi()
  assert.equal(actions.length, invokedBeforeStaleCallback)
  await finishRejected(first.pending)

  const second = await startPendingDownload()
  const removed = makeView()
  removed.exchanges[0]!.responses = [removed.exchanges[0]!.responses[0]!]
  removed.exchanges[0]!.responses[0]!.blocks = [generatedUiBlock({ version: 1, kind: 'draft.text', body: 'Fallback response' }, 'fallback-part')]
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(removed, { supportedActions: ['copy', 'download-text', 'reply'] })} onAction={onAction} onReady={() => {}} />) })
  assert.equal(renderer.root.findByProps({ 'data-native-exchange': 'turn-1' }).props['data-native-response-id'], removed.exchanges[0]!.responses[0]!.id)
  const invokedBeforeRemovalCallback = actions.length
  await runAct(async () => { second.callback() })
  await settleSharedUi()
  assert.equal(actions.length, invokedBeforeRemovalCallback)
  await finishRejected(second.pending)

  const third = await startPendingDownload()
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(removed, { workspaceId: 'workspace-2', supportedActions: ['copy', 'download-text', 'reply'] })} onAction={onAction} onReady={() => {}} />) })
  await finishRejected(third.pending)

  const fourth = await startPendingDownload()
  await runAct(async () => { renderer.unmount() })
  fourth.pending.resolve({ ok: false, error: 'action-failed' })
  await fourth.pending.promise

  assert.equal(actions.filter((request) => request.kind === 'download-text').length, 4)
  assert.ok(actions.filter((request) => request.kind === 'download-text').every((request) => request.kind === 'download-text' && request.target.kind === 'response'))
  assert.equal(selectedResponse.id, actions.find((request) => request.kind === 'download-text')?.kind === 'download-text'
    ? (actions.find((request) => request.kind === 'download-text') as Extract<NativeTranscriptActionRequest, {kind:'download-text'}>).target.responseId
    : '')
})

test('stale Download completion remains quiet after capability revoke and restore', async () => {
  installDomShims()
  const view = makeView()
  view.exchanges[0]!.responses[0]!.blocks = [generatedUiBlock({ version: 1, kind: 'draft.text', body: 'Pending download' })]
  const pending = deferred<NativeTranscriptActionResult>()
  const actions: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => {
    renderer = create(<NativeSharedTranscript snapshot={snapshot(view, { supportedActions: ['copy', 'download-text', 'reply'] })} onAction={async (request) => { actions.push(request); return pending.promise }} onReady={() => {}} />)
  })
  await settleSharedUi()
  await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Download' }).props.onClick() })
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(view, { supportedActions: ['copy', 'reply'] })} onAction={async (request) => { actions.push(request); return pending.promise }} onReady={() => {}} />) })
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(view, { supportedActions: ['copy', 'download-text', 'reply'] })} onAction={async (request) => { actions.push(request); return pending.promise }} onReady={() => {}} />) })
  pending.resolve({ ok: false, error: 'action-failed' })
  await runAct(async () => { await pending.promise })
  await settleSharedUi()
  assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0)
  assert.equal(actions.filter((request) => request.kind === 'download-text').length, 1)
  await runAct(async () => { renderer.unmount() })
})

test('pending Copy and Download survive cloned snapshots and unrelated streaming chunks', async () => {
  installDomShims()
  for (const kind of ['copy', 'download-text'] as const) {
    const view = makeView()
    view.exchanges[0]!.responses[0]!.blocks = [generatedUiBlock({ version: 1, kind: 'draft.text', body: `Stable ${kind} text` })]
    const pending = deferred<NativeTranscriptActionResult>()
    const requests: NativeTranscriptActionRequest[] = []
    const onAction = async (request: NativeTranscriptActionRequest) => { requests.push(request); return pending.promise }
    const actions: NativeTranscriptActionRequest['kind'][] = ['copy', 'download-text', 'reply']
    let renderer!: ReturnType<typeof create>
    const initial = snapshot(view, { supportedActions: actions })
    await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={initial} onAction={onAction} onReady={() => {}} />) })
    await settleSharedUi()
    const label = kind === 'copy' ? 'Copy response' : 'Download'
    await runAct(async () => { renderer.root.findByProps({ 'aria-label': label }).props.onClick() })
    assert.equal(requests[0]?.kind, kind)

    const clonedSnapshot = structuredClone(initial)
    await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={clonedSnapshot} onAction={onAction} onReady={() => {}} />) })
    const streamingView = structuredClone(view)
    streamingView.exchanges[0]!.responses[1]!.status = 'streaming'
    streamingView.exchanges[0]!.responses[1]!.blocks = [generatedUiBlock({ version: 1, kind: 'draft.text', body: 'Unrelated response chunk' })]
    await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(streamingView, { supportedActions: actions })} onAction={onAction} onReady={() => {}} />) })

    pending.resolve({ ok: false, error: 'action-failed' })
    await runAct(async () => { await pending.promise })
    await settleSharedUi()
    assert.equal(requests.length, 1)
    assert.equal(renderer.root.findByProps({ role: 'status' }).children.join(''), 'Action unavailable')
    await runAct(async () => { renderer.unmount() })
  }
})

test('pending user Copy is invalidated when its exchange target disappears and returns', async () => {
  installDomShims()
  const view = makeView()
  const pending = deferred<NativeTranscriptActionResult>()
  const requests: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  const onAction = async (request: NativeTranscriptActionRequest) => { requests.push(request); return pending.promise }
  const actions: NativeTranscriptActionRequest['kind'][] = ['copy', 'reply']
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={snapshot(view, { supportedActions: actions })} onAction={onAction} onReady={() => {}} />) })
  await settleSharedUi()
  await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Copy sent message as Markdown' }).props.onClick() })
  assert.equal(requests[0]?.kind, 'copy')

  const removed = makeView()
  removed.exchanges = []
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(removed, { supportedActions: actions })} onAction={onAction} onReady={() => {}} />) })
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(structuredClone(view), { supportedActions: actions })} onAction={onAction} onReady={() => {}} />) })
  pending.resolve({ ok: false, error: 'action-failed' })
  await runAct(async () => { await pending.promise })
  await settleSharedUi()
  assert.equal(requests.length, 1)
  assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('native stale-scope and unfocused action results do not show a status notice', async () => {
  installDomShims()
  for (const error of ['stale-scope', 'unfocused'] as const) {
    const requests: NativeTranscriptActionRequest[] = []
    let renderer!: ReturnType<typeof create>
    await runAct(async () => {
      renderer = create(<NativeSharedTranscript snapshot={snapshot(makeView(), { supportedActions: ['copy', 'reply'] })}
        onAction={async (request) => { requests.push(request); return { ok: false, error } }} onReady={() => {}} />)
    })
    await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Copy response' }).props.onClick() })
    await settleSharedUi()
    assert.equal(requests.length, 1)
    assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0, error)
    await runAct(async () => { renderer.unmount() })
  }
})

test('focus nonce cancels old readiness feedback without resetting selected response', async () => {
  installDomShims()
  const initialView = makeView()
  const initial = snapshot(initialView)
  const readyScopes: string[] = []
  let finishOldReady!: () => void
  const oldReady = new Promise<void>((resolve) => { finishOldReady = resolve })
  let readyCount = 0
  let renderer!: ReturnType<typeof create>
  await runAct(async () => {
    renderer = create(<NativeSharedTranscript snapshot={initial} onAction={async () => ({ ok: true })} onReady={(current) => {
      readyScopes.push(current.focusNonce)
      if (++readyCount === 1) return oldReady
    }} />)
  })
  await settleSharedUi()
  assert.deepEqual(readyScopes, ['focus-1'])
  const selectedResponseId = initialView.exchanges[0]!.responses[1]!.id
  await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Next response' }).props.onClick() })
  const nextView = makeView()
  nextView.exchanges[0]!.selectedResponseIndex = 0
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(nextView, { focusNonce: 'focus-2' })} onAction={async () => ({ ok: true })} onReady={(current) => { readyScopes.push(current.focusNonce) }} />) })
  await settleSharedUi()
  assert.equal(renderer.root.findByProps({ 'data-native-exchange': 'turn-1' }).props['data-native-response-id'], selectedResponseId)
  assert.deepEqual(readyScopes, ['focus-1', 'focus-2'])
  finishOldReady()
  await settleSharedUi()
  assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('focus-changed unmount rejects current callbacks and pending native feedback', async () => {
  installDomShims()
  const view = makeView()
  view.exchanges[0]!.responses[0]!.blocks = [generatedUiBlock({ version: 1, kind: 'draft.text', body: 'Unmount after focus change' })]
  const requests: NativeTranscriptActionRequest[] = []
  const pending = deferred<NativeTranscriptActionResult>()
  let renderer!: ReturnType<typeof create>
  await runAct(async () => {
    renderer = create(<NativeSharedTranscript snapshot={snapshot(view, { supportedActions: ['copy', 'download-text', 'reply'] })} onAction={async (request) => { requests.push(request); return pending.promise }} onReady={() => {}} />)
  })
  const nextFocus = snapshot(view, { focusNonce: 'focus-2', supportedActions: ['copy', 'download-text', 'reply'] })
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={nextFocus} onAction={async (request) => { requests.push(request); return pending.promise }} onReady={() => {}} />) })
  const oldCopyCallback = renderer.root.findByProps({ 'aria-label': 'Copy response' }).props.onClick as () => void
  await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Download' }).props.onClick() })
  assert.equal(requests.length, 1)
  await runAct(async () => { renderer.unmount() })
  await runAct(async () => { oldCopyCallback() })
  assert.equal(requests.length, 1)
  pending.resolve({ ok: false, error: 'unfocused' })
  await runAct(async () => { await pending.promise })
  await settleSharedUi()
  assert.equal(requests.length, 1)
})

test('focus epoch clears Sources and notice state', async () => {
  installDomShims()
  const view = makeSourcesView()
  let renderer!: ReturnType<typeof create>
  await runAct(async () => {
    renderer = create(<NativeSharedTranscript snapshot={makeSourcesSnapshot(view)} onAction={async (request) => request.kind === 'copy' ? { ok: false, error: 'action-failed' } : { ok: true }} onReady={() => {}} />)
  })
  await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Open sources' }).props.onClick() })
  assert.equal(renderer.root.findAllByProps({ 'data-native-sources': true }).length, 1)
  await runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Copy response' }).props.onClick() })
  await settleSharedUi()
  assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 1)

  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={makeSourcesSnapshot(view, { focusNonce: 'focus-2' })} onAction={async () => ({ ok: true })} onReady={() => {}} />) })
  assert.equal(renderer.root.findAllByProps({ 'data-native-sources': true }).length, 0)
  assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('shared transcript retains response selection, search context, action scope, and disables unsupported writes', async () => {
  installDomShims()
  const initial = snapshot()
  assert.match(initial.view.exchanges[0]!.responses[0]!.id, /openai\/gpt-5/)
  const actions: NativeTranscriptActionRequest[] = []
  const onAction = async (request: NativeTranscriptActionRequest): Promise<NativeTranscriptActionResult> => { actions.push(request); return { ok: true } }
  let ready = 0
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={initial} onAction={onAction} onReady={() => { ready += 1 }} />) })
  await runAct(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert.equal(ready, 1)
  assert.match(JSON.stringify(renderer.toJSON()), /User context/)

  const next = renderer.root.findByProps({ 'aria-label': 'Next response' })
  const selectedResponseId = initial.view.exchanges[0]!.responses[1]!.id
  await runAct(async () => { next.props.onClick() })
  assert.equal(renderer.root.findByProps({ 'data-native-exchange': 'turn-1' }).props['data-native-response-id'], selectedResponseId)
  assert.match(JSON.stringify(renderer.toJSON()), /Variant B search context/)
  const reorderedView = makeView()
  reorderedView.exchanges[0]!.responses = [...reorderedView.exchanges[0]!.responses].reverse()
  reorderedView.exchanges[0]!.selectedResponseIndex = 0
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(reorderedView)} onAction={onAction} onReady={() => { ready += 1 }} />) })
  assert.equal(renderer.root.findByProps({ 'data-native-exchange': 'turn-1' }).props['data-native-response-id'], selectedResponseId)
  assert.match(JSON.stringify(renderer.toJSON()), /Variant B search context/)
  const streamingView = makeView()
  streamingView.exchanges[0]!.status = 'streaming'
  streamingView.exchanges[0]!.responses[1]!.status = 'streaming'
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(streamingView, { query: 'User context' })} onAction={onAction} onReady={() => { ready += 1 }} />) })
  assert.match(JSON.stringify(renderer.toJSON()), /Variant B search context/)
  const removedVariant = makeView()
  const removedExchange = removedVariant.exchanges[0] as unknown as { responses: unknown[]; selectedResponseIndex: number }
  removedExchange.responses = [removedExchange.responses[0]!]
  removedExchange.selectedResponseIndex = 0
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(removedVariant)} onAction={onAction} onReady={() => { ready += 1 }} />) })
  assert.match(JSON.stringify(renderer.toJSON()), /Variant A/)
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(makeView(), { query: 'Variant B search context' })} onAction={onAction} onReady={() => { ready += 1 }} />) })
  assert.match(JSON.stringify(renderer.toJSON()), /User context/)
  assert.match(JSON.stringify(renderer.toJSON()), /Variant A/)

  const reply = renderer.root.findByProps({ 'aria-label': 'Reply' })
  await runAct(async () => { reply.props.onClick() })
  assert.deepEqual(actions.at(-1), { kind: 'reply', ...scope, exchangeId: 'turn-1', target: { kind: 'response', responseId: initial.view.exchanges[0]!.responses[0]!.id } })
  const deleteButton = renderer.root.findByProps({ 'aria-label': 'Delete this turn from history' })
  assert.equal(deleteButton.props.disabled, true)
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Regenerate response' }).length, 0)
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Branch chat from here' }).length, 0)
  const switchedScopeView = makeView()
  switchedScopeView.exchanges[0]!.selectedResponseIndex = 1
  await runAct(async () => {
    renderer.update(<NativeSharedTranscript snapshot={snapshot(switchedScopeView, { conversationId: 'conversation-2' })} onAction={onAction} onReady={() => { ready += 1 }} />)
  })
  assert.equal(renderer.root.findByProps({ 'data-native-exchange': 'turn-1' }).props['data-native-response-id'], selectedResponseId)
  await runAct(async () => { renderer.unmount() })
})

test('pending action completion from an old keyed scope cannot show a notice in the new scope', async () => {
  installDomShims()
  let finishAction!: (result: NativeTranscriptActionResult) => void
  const pending = new Promise<NativeTranscriptActionResult>((resolve) => { finishAction = resolve })
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={snapshot()} onAction={() => pending} onReady={() => {}} />) })
  const copy = renderer.root.findByProps({ 'aria-label': 'Copy response' })
  await runAct(async () => { void copy.props.onClick() })
  await runAct(async () => {
    renderer.update(<NativeSharedTranscript snapshot={snapshot(makeView(), { conversationId: 'conversation-2' })} onAction={async () => ({ ok: true })} onReady={() => {}} />)
  })
  await runAct(async () => { finishAction({ ok: false, error: 'action-failed' }); await pending; await Promise.resolve() })
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Action unavailable/)
  await runAct(async () => { renderer.unmount() })
})

test('delayed readiness is canceled by a scope switch or unmount', async () => {
  installDomShims()
  let finishFonts!: () => void
  const fontsReady = new Promise<void>((resolve) => { finishFonts = resolve })
  ;(globalThis as unknown as { document: { fonts: { ready: Promise<void> } } }).document.fonts.ready = fontsReady
  const readyScopes: string[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={snapshot()} onAction={async () => ({ ok: true })} onReady={(current) => { readyScopes.push(current.conversationId) }} />) })
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(makeView(), { conversationId: 'conversation-2' })} onAction={async () => ({ ok: true })} onReady={(current) => { readyScopes.push(current.conversationId) }} />) })
  finishFonts()
  await runAct(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
  assert.deepEqual(readyScopes, ['conversation-2'])
  await runAct(async () => { renderer.unmount() })

  installDomShims()
  let finishUnmountedFonts!: () => void
  ;(globalThis as unknown as { document: { fonts: { ready: Promise<void> } } }).document.fonts.ready = new Promise<void>((resolve) => { finishUnmountedFonts = resolve })
  const afterUnmount: string[] = []
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={snapshot()} onAction={async () => ({ ok: true })} onReady={(current) => { afterUnmount.push(current.conversationId) }} />) })
  await runAct(async () => { renderer.unmount() })
  finishUnmountedFonts()
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(afterUnmount, [])
})

test('shared message links dispatch with the actual user or selected response target', async () => {
  installDomShims()
  const actions: NativeTranscriptActionRequest[] = []
  const onAction = async (request: NativeTranscriptActionRequest): Promise<NativeTranscriptActionResult> => { actions.push(request); return { ok: true } }
  const view = makeView()
  const responseId = view.exchanges[0]!.responses[0]!.id
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={snapshot(view)} onAction={onAction} onReady={() => {}} />) })
  const viewport = renderer.root.findByProps({ 'aria-label': 'Conversation' })
  await runAct(async () => { fireLinkClick(viewport, 'https://user.example/path', 'end', responseId); await Promise.resolve() })
  await runAct(async () => { fireLinkClick(viewport, 'https://assistant.example/path', 'start', responseId); await Promise.resolve() })
  assert.deepEqual(actions.map((action) => action.kind === 'open-link' ? action.target : null), [
    { kind: 'user', userId: 'user-1' },
    { kind: 'response', responseId },
  ])
  await runAct(async () => { renderer.unmount() })
})

test('copy failures are rejected safely and keyboard dismissal requires trusted pointer drag', async () => {
  installDomShims()
  const actions: NativeTranscriptActionRequest[] = []
  const onAction = async (request: NativeTranscriptActionRequest): Promise<NativeTranscriptActionResult> => {
    actions.push(request)
    return request.kind === 'copy' ? { ok: false, error: 'action-failed' } : { ok: true }
  }
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={snapshot()} onAction={onAction} onReady={() => {}} />) })
  const copy = renderer.root.findByProps({ 'aria-label': 'Copy response' })
  await runAct(async () => { await copy.props.onClick() })
  assert.equal(actions[0]?.kind, 'copy')
  assert.deepEqual(actions[0]?.kind === 'copy' ? actions[0].target : null, { kind: 'response', responseId: snapshot().view.exchanges[0]!.responses[0]!.id })
  assert.match(JSON.stringify(renderer.toJSON()), /Action unavailable/)
  const userCopy = renderer.root.findByProps({ 'aria-label': 'Copy sent message as Markdown' })
  await runAct(async () => { await userCopy.props.onClick() })
  assert.deepEqual(actions[1]?.kind === 'copy' ? actions[1].target : null, { kind: 'user', userId: 'user-1' })

  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={snapshot(makeView(), { scrollIntent: { id: 'programmatic-submission', kind: 'submission' } })} onAction={onAction} onReady={() => {}} />); await Promise.resolve() })
  assert.equal(actions.some((request) => request.kind === 'keyboard-dismiss'), false)
  const viewport = renderer.root.findByProps({ 'aria-label': 'Conversation' })
  const scroll = viewport.props.onScroll as ((event: unknown) => void) | undefined
  if (scroll) await runAct(async () => { scroll({ currentTarget: { scrollTop: 40, scrollHeight: 100, clientHeight: 60 } }) })
  assert.equal(actions.some((request) => request.kind === 'keyboard-dismiss'), false)
  await runAct(async () => {
    viewport.props.onPointerDown({ isTrusted: false, isPrimary: true, pointerId: 4, clientY: 0 })
    viewport.props.onPointerMove({ isTrusted: false, pointerId: 4, clientY: 30 })
  })
  assert.equal(actions.some((request) => request.kind === 'keyboard-dismiss'), false)
  await runAct(async () => {
    viewport.props.onPointerDown({ isTrusted: true, isPrimary: true, pointerId: 5, clientY: 0 })
    viewport.props.onPointerMove({ isTrusted: true, pointerId: 5, clientY: 30 })
  })
  assert.equal(actions.some((request) => request.kind === 'keyboard-dismiss'), true)
  await runAct(async () => { renderer.unmount() })
})

test('shared Sources control opens actual provider and citation rows with scoped native requests', async () => {
  installDomShims()
  const view = makeSourcesView()
  const projected = makeSourcesSnapshot(view)
  const exchange = projected.view.exchanges[0]!
  const response = exchange.responses[0]!
  assert.ok(response.id.includes('/'))
  const actions: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={projected} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })

  const sourcesButton = renderer.root.findByProps({ 'aria-label': 'Open sources' })
  await runAct(async () => { sourcesButton.props.onClick() })
  const panel = renderer.root.findByProps({ variant: 'shell' })
  assert.equal(panel.props.variant, 'shell')
  const wrapper = renderer.root.findByProps({ 'data-native-sources': true })
  const publicHref = 'https://public.example/reference'
  const fileCitation = response.sourceCitations?.['1']
  assert.ok(fileCitation)
  assert.equal(fileCitation.sourceId, 'opaque_citation_handle_000022')
  const fileCitationHref = knowledgeSourceHref({ kind: 'file', sourceId: fileCitation.sourceId })
  const memoryCitationHref = knowledgeSourceHref({ kind: 'memory', sourceId: 'memory-resource-2' })
  const providerFileHref = knowledgeSourceHref({ kind: 'file', sourceId: 'opaque_asset_handle_000021' })
  const unknownFileHref = knowledgeSourceHref({ kind: 'file', sourceId: 'not-registered' })
  for (const href of [publicHref, fileCitationHref, memoryCitationHref, providerFileHref]) {
    assert.ok(renderer.root.findAllByProps({ href }).length > 0, `missing Sources row for ${href}`)
  }
  assert.equal(renderer.root.findAllByProps({ href: unknownFileHref }).length, 0)

  await runAct(async () => {
    fireCapturedHref(wrapper.props.onClickCapture, publicHref)
    fireCapturedHref(wrapper.props.onClickCapture, providerFileHref)
    fireCapturedHref(wrapper.props.onClickCapture, fileCitationHref)
    fireCapturedHref(wrapper.props.onClickCapture, memoryCitationHref)
  })
  const beforeUntrustedLink = actions.length
  await runAct(async () => { fireCapturedHref(wrapper.props.onClickCapture, '/app/files?file=not-a-known-source') })
  assert.equal(actions.length, beforeUntrustedLink)
  assert.deepEqual(actions, [
    { kind: 'open-source', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, sourceId: 'provider-url-source' },
    { kind: 'open-source', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, sourceId: 'provider-file-source' },
    { kind: 'open-citation', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, citationKey: '1' },
    { kind: 'open-citation', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, citationKey: '2' },
  ])

  const viewport = renderer.root.findByProps({ 'aria-label': 'Conversation' })
  const host = { dataset: { nativeExchange: exchange.id, nativeResponseId: response.id } }
  await runAct(async () => { fireCapturedHref(viewport.props.onClickCapture, providerFileHref, host) })
  assert.deepEqual(actions[4], { kind: 'open-source', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, sourceId: 'provider-file-source' })
  await runAct(async () => { fireCapturedHref(viewport.props.onClickCapture, fileCitationHref, host) })
  assert.deepEqual(actions[5], { kind: 'open-citation', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, citationKey: '1' })
  const beforeUserCitationHref = actions.length
  await runAct(async () => { fireLinkClick(viewport, fileCitationHref, 'end', response.id, exchange.id) })
  assert.equal(actions.length, beforeUserCitationHref)

  const close = renderer.root.findByProps({ 'aria-label': 'Close sources' })
  await runAct(async () => { close.props.onClick() })
  assert.equal(renderer.root.findAllByProps({ 'data-native-sources': true }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('Sources panel clears on target removal, action revocation, and scope change without stale dispatch', async () => {
  installDomShims()
  const view = makeSourcesView()
  const actions: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={makeSourcesSnapshot(view)} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })
  const openPanel = async () => runAct(async () => { renderer.root.findByProps({ 'aria-label': 'Open sources' }).props.onClick() })
  await openPanel()
  const stalePanelClick = renderer.root.findByProps({ 'data-native-sources': true }).props.onClickCapture as (...args: unknown[]) => unknown

  const removed = structuredClone(view)
  removed.exchanges = []
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={makeSourcesSnapshot(removed)} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })
  assert.equal(renderer.root.findAllByProps({ 'data-native-sources': true }).length, 0)
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={makeSourcesSnapshot(view)} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })
  assert.equal(renderer.root.findAllByProps({ 'data-native-sources': true }).length, 0)

  await openPanel()
  const actionCount = actions.length
  const revoked = makeSourcesSnapshot(view, { supportedActions: ['copy'] })
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={revoked} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })
  assert.equal(renderer.root.findAllByProps({ 'data-native-sources': true }).length, 0)
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={makeSourcesSnapshot(view)} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })
  assert.equal(renderer.root.findAllByProps({ 'data-native-sources': true }).length, 0)

  await openPanel()
  const scopedSnapshot = makeSourcesSnapshot(view, { conversationId: 'conversation-2' })
  await runAct(async () => { renderer.update(<NativeSharedTranscript snapshot={scopedSnapshot} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })
  await runAct(async () => { fireCapturedHref(stalePanelClick, 'https://public.example/reference') })
  assert.equal(actions.length, actionCount)
  assert.equal(renderer.root.findAllByProps({ 'data-native-sources': true }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('media projection accepts only matching prepared image assets and sanitizes invalid kinds and statuses', () => {
  const rawUrl = 'data:image/png;base64,cmF3LXJlc3VsdA=='
  const view = makeMediaView([output('image-output-1', 'image', 'completed', rawUrl)])
  const original = JSON.stringify(view)
  const exchange = view.exchanges[0]!
  const prepared = 'data:image/png;base64,cHJlcGFyZWQ='
  const asset: NativeTranscriptProjectionAsset = {
    handle: 'opaque_output_handle_0001', exchangeId: exchange.id, resourceId: 'image-output-1',
    resourceKind: 'output', previewable: true, previewDataUrl: prepared,
  }

  const noRegistration = makeMediaSnapshot(view)
  assert.equal(noRegistration.media[0]?.results[0]?.previewDataUrl, undefined)
  assert.equal(JSON.stringify(noRegistration).includes(rawUrl), false)

  const projected = makeMediaSnapshot(view, [asset])
  assert.equal(projected.media[0]?.results[0]?.previewDataUrl, prepared)
  assert.equal(projected.assets[0]?.handle, asset.handle)
  assert.equal(JSON.stringify(projected).includes(rawUrl), false)
  assert.equal(JSON.stringify(view), original)

  const mismatchedAssets: NativeTranscriptProjectionAsset[] = [
    { ...asset, exchangeId: 'another-exchange' },
    { ...asset, resourceId: 'different-output' },
    { ...asset, previewable: false },
    { ...asset, resourceKind: 'file' },
  ]
  for (const mismatched of mismatchedAssets) {
    const rejected = makeMediaSnapshot(view, [mismatched])
    assert.equal(rejected.assets.length, 0)
    assert.equal(rejected.media[0]?.results[0]?.previewDataUrl, undefined)
  }

  const invalid = structuredClone(view)
  const invalidMedia = invalid.exchanges[0]!.media as unknown as {
    kind: string
    results: Array<{ type: string; status: string }>
  }
  invalidMedia.kind = 'audio'
  invalidMedia.results[0]!.type = 'audio'
  invalidMedia.results[0]!.status = 'rendering'
  const invalidSnapshot = makeMediaSnapshot(invalid)
  assert.equal(invalidSnapshot.media[0]?.kind, 'unsupported')
  assert.equal(invalidSnapshot.media[0]?.results[0]?.type, 'unsupported')
  assert.equal(invalidSnapshot.media[0]?.results[0]?.status, 'unavailable')
  assert.doesNotMatch(JSON.stringify(invalidSnapshot), /audio|rendering/)
  assert.equal(invalidSnapshot.view.exchanges[0]?.media, null)
})

test('user-only media prompt and empty result state use shared Copy and prompt Reply targets', async () => {
  installDomShims()
  const prompt = 'Render this user prompt once'
  const view = makeMediaView([], 'image', prompt)
  assert.equal(view.exchanges[0]?.responses.length, 0)
  assert.equal(view.exchanges[0]?.media, null)
  const projected = makeMediaSnapshot(view)
  assert.equal(projected.media[0]?.results.length, 0)
  const actions: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={projected} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })

  assert.equal(renderer.root.findAllByProps({ 'data-native-media-empty': 'true' }).length, 1)
  assert.equal(renderedText(renderer.toJSON()).split(prompt).length - 1, 1)
  const copy = renderer.root.findByProps({ 'aria-label': 'Copy sent message as Markdown' })
  await runAct(async () => { copy.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert.deepEqual(actions[0], { kind: 'copy', ...scope, exchangeId: view.exchanges[0]!.id, target: { kind: 'user', userId: view.exchanges[0]!.user.id }, text: prompt })

  const reply = renderer.root.findByProps({ 'aria-label': 'Reply to prompt' })
  await runAct(async () => { reply.props.onClick() })
  assert.deepEqual(actions[1], { kind: 'reply', ...scope, exchangeId: view.exchanges[0]!.id, target: { kind: 'user', userId: view.exchanges[0]!.user.id } })
  assert.doesNotMatch(renderedText(renderer.toJSON()), /Failed/)
  await runAct(async () => { renderer.unmount() })

  const noReplySnapshot = makeMediaSnapshot(view, [], ['copy'])
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={noReplySnapshot} onAction={async () => ({ ok: true })} onReady={() => {}} />) })
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Reply to prompt' }).length, 0)
  assert.ok(renderer.root.findAllByProps({ 'aria-label': 'Copy sent message as Markdown' }).length > 0)
  await runAct(async () => { renderer.unmount() })

  const noCopySnapshot = makeMediaSnapshot(view, [], ['reply'])
  const noCopyActions: NativeTranscriptActionRequest[] = []
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={noCopySnapshot} onAction={async (request) => { noCopyActions.push(request); return { ok: true } }} onReady={() => {}} />) })
  assert.equal(renderer.root.findAllByProps({ 'data-native-copy-disabled': 'true' }).length, 1)
  const unavailableCopy = renderer.root.findByProps({ 'aria-label': 'Copy sent message as Markdown' })
  await runAct(async () => { unavailableCopy.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert.equal(noCopyActions.length, 0)
  assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('shared MediaExchange keeps single generating and failed results honest and prompt-scoped', async () => {
  installDomShims()
  const generatingView = makeMediaView([output('generating-output', 'image', 'pending')])
  const generatingSnapshot = makeMediaSnapshot(generatingView)
  const generatingActions: NativeTranscriptActionRequest[] = []
  let generatingRenderer!: ReturnType<typeof create>
  await runAct(async () => { generatingRenderer = create(<NativeSharedTranscript snapshot={generatingSnapshot} onAction={async (request) => { generatingActions.push(request); return { ok: true } }} onReady={() => {}} />) })
  assert.equal(generatingSnapshot.media[0]?.results[0]?.status, 'generating')
  assert.equal(generatingRenderer.root.findByProps({ 'data-native-media-status': 'generating' }).props['data-native-media-result'], 0)
  assert.match(renderedText(generatingRenderer.toJSON()), /Creating image/)
  assert.doesNotMatch(renderedText(generatingRenderer.toJSON()), /Failed/)
  assert.equal(renderedText(generatingRenderer.toJSON()).split('Generate one media result').length - 1, 1)
  const generatingReply = generatingRenderer.root.findByProps({ 'aria-label': 'Reply to prompt' })
  await runAct(async () => { generatingReply.props.onClick() })
  assert.deepEqual(generatingActions[0], { kind: 'reply', ...scope, exchangeId: generatingView.exchanges[0]!.id, target: { kind: 'user', userId: generatingView.exchanges[0]!.user.id } })
  assert.equal(generatingRenderer.root.findAllByProps({ 'title': 'Download' }).length, 0)
  await runAct(async () => { generatingRenderer.unmount() })

  const failedView = makeMediaView([output('failed-output', 'image', 'failed')])
  const failedSnapshot = makeMediaSnapshot(failedView)
  const failedActions: NativeTranscriptActionRequest[] = []
  let failedRenderer!: ReturnType<typeof create>
  await runAct(async () => { failedRenderer = create(<NativeSharedTranscript snapshot={failedSnapshot} onAction={async (request) => { failedActions.push(request); return { ok: true } }} onReady={() => {}} />) })
  assert.equal(failedSnapshot.media[0]?.results[0]?.status, 'failed')
  assert.match(renderedText(failedRenderer.toJSON()), /Failed/)
  assert.equal(renderedText(failedRenderer.toJSON()).split('Generate one media result').length - 1, 1)
  const deleteAction = failedRenderer.root.findByProps({ 'aria-label': 'Delete this turn from history' })
  assert.equal(deleteAction.props.disabled, true)
  assert.equal(failedRenderer.root.findAllByProps({ 'aria-label': 'Retry generation' }).length, 0)
  const copyPrompt = failedRenderer.root.findByProps({ 'aria-label': 'Copy prompt' })
  await runAct(async () => { copyPrompt.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)) })
  const failedReply = failedRenderer.root.findByProps({ 'aria-label': 'Reply' })
  await runAct(async () => { failedReply.props.onClick() })
  assert.deepEqual(failedActions[0], { kind: 'copy', ...scope, exchangeId: failedView.exchanges[0]!.id, target: { kind: 'user', userId: failedView.exchanges[0]!.user.id }, text: failedView.exchanges[0]!.user.text })
  assert.deepEqual(failedActions[1], { kind: 'reply', ...scope, exchangeId: failedView.exchanges[0]!.id, target: { kind: 'user', userId: failedView.exchanges[0]!.user.id } })
  assert.equal(failedRenderer.root.findAllByProps({ title: 'Download' }).length, 0)
  await runAct(async () => { failedRenderer.unmount() })
})

test('completed protected media opens only its registered native preview and replies to the known output', async () => {
  installDomShims()
  const protectedUrl = 'https://private.example/outputs/item?access_token=MEDIA_SECRET_SENTINEL'
  const view = makeMediaView([output('protected-output', 'image', 'completed', protectedUrl)])
  const exchange = view.exchanges[0]!
  const asset: NativeTranscriptProjectionAsset = {
    handle: 'opaque_output_handle_0002', exchangeId: exchange.id, resourceId: 'protected-output',
    resourceKind: 'output', previewable: true, label: 'Generated image',
  }
  const projected = makeMediaSnapshot(view, [asset])
  assert.doesNotMatch(JSON.stringify(projected), /MEDIA_SECRET_SENTINEL|private\.example/)
  assert.equal(projected.media[0]?.results[0]?.previewDataUrl, undefined)
  const actions: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={projected} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })

  assert.match(renderedText(renderer.toJSON()), /Preview unavailable in transcript/)
  assert.equal(renderer.root.findAllByProps({ 'data-native-media-preview': 'image' }).length, 0)
  const open = renderer.root.findByProps({ 'aria-label': 'Open native media preview' })
  await runAct(async () => { open.props.onClick() })
  assert.deepEqual(actions[0], { kind: 'open-asset', ...scope, exchangeId: exchange.id, assetHandle: asset.handle })
  const reply = renderer.root.findByProps({ 'aria-label': 'Reply to generated media' })
  await runAct(async () => { reply.props.onClick() })
  assert.deepEqual(actions[1], { kind: 'reply', ...scope, exchangeId: exchange.id, target: { kind: 'media', assetHandle: asset.handle } })
  assert.equal(renderer.root.findAllByProps({ title: 'Download' }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('prepared image bytes are scoped to matching image outputs and never reach video or unregistered results', async () => {
  installDomShims()
  const prepared = 'data:image/png;base64,cHJlcGFyZWQ='
  const raw = 'data:image/png;base64,dHJ1c3RlZC1yYXctdXJs'
  const imageView = makeMediaView([output('safe-image-output', 'image', 'completed', raw)])
  const imageExchange = imageView.exchanges[0]!
  const imageAsset: NativeTranscriptProjectionAsset = {
    handle: 'opaque_output_handle_0003', exchangeId: imageExchange.id, resourceId: 'safe-image-output',
    resourceKind: 'output', previewable: true, previewDataUrl: prepared,
  }
  const imageSnapshot = makeMediaSnapshot(imageView, [imageAsset])
  assert.equal(imageSnapshot.media[0]?.results[0]?.previewDataUrl, prepared)
  assert.equal(JSON.stringify(imageSnapshot).includes(raw), false)
  const imageActions: NativeTranscriptActionRequest[] = []
  let imageRenderer!: ReturnType<typeof create>
  await runAct(async () => { imageRenderer = create(<NativeSharedTranscript snapshot={imageSnapshot} onAction={async (request) => { imageActions.push(request); return { ok: true } }} onReady={() => {}} />) })
  const imagePreview = imageRenderer.root.findByProps({ 'data-native-media-preview': 'image' })
  assert.equal(imagePreview.props.src, prepared)
  assert.equal(imageRenderer.root.findAllByProps({ title: 'Download' }).length, 0)
  await runAct(async () => { imageRenderer.unmount() })

  const videoView = makeMediaView([output('safe-video-output', 'video', 'completed', raw)], 'video')
  const videoExchange = videoView.exchanges[0]!
  const imageBytesOnVideo: NativeTranscriptProjectionAsset = {
    handle: 'opaque_output_handle_0004', exchangeId: videoExchange.id, resourceId: 'safe-video-output',
    resourceKind: 'output', previewable: true, previewDataUrl: prepared,
  }
  const videoSnapshot = makeMediaSnapshot(videoView, [imageBytesOnVideo])
  assert.equal(videoSnapshot.assets[0]?.previewDataUrl, undefined)
  assert.equal(videoSnapshot.media[0]?.results[0]?.previewDataUrl, undefined)
  assert.equal(JSON.stringify(videoSnapshot).includes(prepared), false)
  let videoRenderer!: ReturnType<typeof create>
  await runAct(async () => { videoRenderer = create(<NativeSharedTranscript snapshot={videoSnapshot} onAction={async () => ({ ok: true })} onReady={() => {}} />) })
  assert.equal(videoRenderer.root.findAllByProps({ controls: true }).length, 0)
  assert.equal(videoRenderer.root.findAllByProps({ 'data-native-media-preview': 'image' }).length, 0)
  assert.match(renderedText(videoRenderer.toJSON()), /Preview unavailable in transcript/)
  await runAct(async () => { videoRenderer.unmount() })
})

test('mixed and multiple media results retain every output, one prompt, and trusted reply targets', async () => {
  installDomShims()
  const view = makeMediaView([
    output('mixed-image-complete', 'image', 'completed', 'https://private.example/image'),
    output('mixed-video-failed', 'video', 'failed'),
    output('mixed-image-generating', 'image', 'pending'),
  ])
  const exchange = view.exchanges[0]!
  assert.equal(view.exchanges[0]!.media?.results.length, 3)
  const outputHandle = 'opaque_mixed_output_handle_0001'
  const projected = makeMediaSnapshot(view, [{
    handle: outputHandle, exchangeId: exchange.id, resourceId: 'mixed-image-complete', resourceKind: 'output', previewable: true,
  }])
  assert.equal(projected.media[0]?.results[0]?.assetHandle, outputHandle)
  assert.equal(projected.media[0]?.results[1]?.assetHandle, undefined)
  assert.equal(projected.media[0]?.results[2]?.assetHandle, undefined)
  assert.equal(JSON.stringify(projected).includes('mixed-image-complete'), false)
  const actions: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={projected} onAction={async (request) => { actions.push(request); return { ok: true } }} onReady={() => {}} />) })
  assert.equal(renderer.root.findAllByProps({ 'data-native-media-result': 0 }).length, 1)
  assert.equal(renderer.root.findAllByProps({ 'data-native-media-result': 1 }).length, 1)
  assert.equal(renderer.root.findAllByProps({ 'data-native-media-result': 2 }).length, 1)
  assert.equal(renderedText(renderer.toJSON()).split('Generate one media result').length - 1, 1)
  const replyToOutput = renderer.root.findByProps({ 'aria-label': 'Reply to generated media' })
  await runAct(async () => { replyToOutput.props.onClick() })
  assert.deepEqual(actions[0], { kind: 'reply', ...scope, exchangeId: exchange.id, target: { kind: 'media', assetHandle: outputHandle } })
  const promptReplies = renderer.root.findAllByProps({ 'aria-label': 'Reply to prompt' }) as Array<{ props: { onClick: () => void } }>
  assert.ok(promptReplies.length >= 2)
  for (const promptReply of promptReplies) await runAct(async () => { promptReply.props.onClick() })
  for (const action of actions.slice(1)) {
    assert.deepEqual(action, { kind: 'reply', ...scope, exchangeId: exchange.id, target: { kind: 'user', userId: exchange.user.id } })
  }
  assert.equal(renderer.root.findAllByProps({ title: 'Download' }).length, 0)
  await runAct(async () => { renderer.unmount() })
})

test('shared prompt Copy rejects native failure without false success', async () => {
  installDomShims()
  const view = makeMediaView([], 'image', 'Copy failure prompt')
  const projected = makeMediaSnapshot(view)
  const actions: NativeTranscriptActionRequest[] = []
  let renderer!: ReturnType<typeof create>
  await runAct(async () => { renderer = create(<NativeSharedTranscript snapshot={projected} onAction={async (request) => { actions.push(request); return { ok: false, error: 'unknown-target' } }} onReady={() => {}} />) })
  const copy = renderer.root.findByProps({ 'aria-label': 'Copy sent message as Markdown' })
  await runAct(async () => { copy.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert.deepEqual(actions, [{ kind: 'copy', ...scope, exchangeId: view.exchanges[0]!.id, target: { kind: 'user', userId: view.exchanges[0]!.user.id }, text: 'Copy failure prompt' }])
  assert.match(renderedText(renderer.toJSON()), /Action unavailable/)
  await runAct(async () => { renderer.unmount() })
})
