import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import React, { act, type ReactElement, type ReactNode } from 'react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { AuthProvider } from '@/contexts/AuthContext'
import { useWorkspace, WorkspaceProvider } from '@/contexts/WorkspaceContext'
import type { WorkspaceClient, WorkspaceSummary } from '@/shared/workspaces/types'
import { ConvexAuthProvider } from '@/components/providers/ConvexAuthProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import SkillsView from './SkillsView'
import { SkillDraft } from './NativeSkillsView'
import { SkillDialog } from '@overlay/modules-react/extensions'
import type { SkillFormValues } from '@overlay/app-core'

type Instance = { props: Record<string, unknown>; children: Array<Instance | string> }
type Renderer = { root: { findAllByType(type: string): Instance[] }; update(element: ReactElement): void; unmount(): void }
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: ReactElement): Renderer
}
type NativeSkill = NonNullable<FunctionReturnType<typeof api.integrations.nativeSkills.get>>
type SkillDraftProps = React.ComponentProps<typeof SkillDraft>
type SaveSkill = React.ComponentProps<typeof SkillDialog>['onSave']

function nativeSkill(revision: number, name: string): NativeSkill {
  return {
    _id: 'skill-1' as Id<'skills'>,
    userId: 'test-user',
    workspaceId: 'workspace-a',
    name,
    description: 'Original description',
    instructions: 'Original instructions',
    enabled: true,
    scope: 'personal',
    createdAt: 1,
    updatedAt: 1,
    revision,
    editable: true,
    options: { moveTo: null, canArchive: false, canRestore: false },
  }
}

function installBrowser(t: TestContext) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const cleanups: Array<() => void | Promise<void>> = []
  const values = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  const window = Object.assign(new EventTarget(), {
    localStorage,
    location: { search: '', hash: '' },
    setInterval: () => 1,
    clearInterval: () => undefined,
  })
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => new Response(null, { status: 404 }),
  })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch)
    else Reflect.deleteProperty(globalThis, 'fetch')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  return (cleanup: () => void | Promise<void>) => cleanups.push(cleanup)
}

function SkillDialogFields(props: React.ComponentProps<typeof SkillDialog>) {
  const dialog = SkillDialog(props) as ReactElement<{ children?: ReactNode; scopeActions?: ReactNode }>
  return <>{dialog.props.children}{dialog.props.scopeActions}</>
}

function NativeSkillDraftFields({ captureOnSave, ...props }: SkillDraftProps & {
  captureOnSave: (handler: SaveSkill) => void
}) {
  const dialog = SkillDraft(props) as ReactElement<React.ComponentProps<typeof SkillDialog>>
  captureOnSave(dialog.props.onSave)
  return <SkillDialogFields {...dialog.props} />
}

test('a native dirty draft survives a remote revision and rejects its stale save', async t => {
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const cleanups: Array<() => void | Promise<void>> = []
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  const initial = nativeSkill(1, 'Original name')
  const updateCalls: unknown[] = []
  const controller = {
    update: async (args: unknown) => { updateCalls.push(args) },
  } as unknown as SkillDraftProps['controller']
  const props = { workspaceId: 'workspace-a', current: initial, controller, onClose: () => undefined }
  let saveHandler!: SaveSkill
  let renderer!: Renderer
  await act(async () => {
    renderer = create(<NativeSkillDraftFields {...props} captureOnSave={handler => { saveHandler = handler }} />)
  })
  cleanups.push(async () => { await act(async () => renderer.unmount()) })
  const nameInput = () => renderer.root.findAllByType('input').find(node => node.props['aria-label'] === 'Name')
  const input = nameInput()
  assert.ok(input)
  await act(async () => {
    ;(input.props.onChange as (event: unknown) => void)({ target: { value: 'Unsaved local draft' } })
  })
  await act(async () => {
    renderer.update(<NativeSkillDraftFields {...props} current={nativeSkill(2, 'Remote name')}
      captureOnSave={handler => { saveHandler = handler }} />)
  })
  assert.equal(nameInput()?.props.value, 'Unsaved local draft')
  const conflict = renderer.root.findAllByType('p').find(node => node.props.role === 'alert')
  assert.ok(conflict)
  assert.match(conflict.children.join(''), /This skill changed elsewhere/)

  let result: boolean | void
  await act(async () => {
    result = await saveHandler({
      name: nameInput()?.props.value as string,
      description: 'Original description',
      instructions: 'Original instructions',
      enabled: true,
    })
  })
  assert.equal(result, false)
  assert.deepEqual(updateCalls, [])
  assert.equal(nameInput()?.props.value, 'Unsaved local draft')
})

test('native saves send the revision captured in the unchanged draft baseline', async t => {
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const cleanups: Array<() => void | Promise<void>> = []
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  const initial = nativeSkill(7, 'Baseline name')
  const updateCalls: unknown[] = []
  const controller = {
    update: async (args: unknown) => { updateCalls.push(args) },
  } as unknown as SkillDraftProps['controller']
  const props = { workspaceId: 'workspace-a', current: initial, controller, onClose: () => undefined }
  let saveHandler!: SaveSkill
  let renderer!: Renderer
  await act(async () => {
    renderer = create(<NativeSkillDraftFields {...props} captureOnSave={handler => { saveHandler = handler }} />)
  })
  cleanups.push(async () => { await act(async () => renderer.unmount()) })
  const values: SkillFormValues = {
    name: 'Baseline name',
    description: 'Original description',
    instructions: 'Original instructions',
    enabled: true,
  }
  let result: boolean | void
  await act(async () => {
    result = await saveHandler(values)
  })
  assert.equal(result, true)
  assert.deepEqual(updateCalls, [{
    workspaceId: 'workspace-a',
    skillId: initial._id,
    expectedRevision: 7,
    ...values,
  }])
})

test('configured native auth without a client never mounts legacy HTTP skills access, including workspace switches', async t => {
  const addCleanup = installBrowser(t)
  const user = { id: 'test-user', email: 'test@example.test' }
  const workspace = {
    id: 'workspace-a', kind: 'organization', name: 'Workspace A', slug: 'workspace-a',
  } as WorkspaceSummary
  let finishSwitch!: (value: { workspace: WorkspaceSummary }) => void
  const client = {
    list: async () => ({ workspaces: [workspace], activeWorkspaceId: workspace.id }),
    create: async () => { throw new Error('not used') },
    activate: async () => await new Promise<{ workspace: WorkspaceSummary }>(resolve => { finishSwitch = resolve }),
  } as unknown as WorkspaceClient
  const http = t.mock.method(overlayAppClient.skills, 'get', async () => [])
  const router = {
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => undefined,
    bfcacheId: 'test',
  }
  const params = new URLSearchParams()
  const wrap = (children: ReactElement) => (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value="/home">
        <SearchParamsContext.Provider value={params}>
          <AuthProvider initialUser={user} initialSessionResolved>
            <ConvexAuthProvider requiresConvexClient={false} nativeAuthConfigured>
              <WorkspaceProvider client={client}>{children}</WorkspaceProvider>
            </ConvexAuthProvider>
          </AuthProvider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  )
  let renderer!: Renderer
  await act(async () => {
    renderer = create(wrap(<SkillsView userId={user.id} />))
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  addCleanup(async () => { await act(async () => renderer.unmount()) })
  assert.match(renderer.root.findAllByType('p').map(node => node.children.join('')).join(' '), /Skills are unavailable/)
  assert.equal(http.mock.callCount(), 0)

  let switchRenderer!: Renderer
  function StartSwitch() {
    const { useEffect } = React
    const { switchWorkspace } = useWorkspace()
    useEffect(() => { void switchWorkspace('workspace-b') }, [switchWorkspace])
    return null
  }
  await act(async () => {
    switchRenderer = create(wrap(<><SkillsView userId={user.id} /><StartSwitch /></>))
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  addCleanup(async () => { await act(async () => switchRenderer.unmount()) })
  assert.match(switchRenderer.root.findAllByType('p').map(node => node.children.join('')).join(' '), /Loading workspace/)
  assert.equal(http.mock.callCount(), 0)
  await act(async () => {
    finishSwitch({ workspace: { ...workspace, id: 'workspace-b', slug: 'workspace-b', name: 'Workspace B' } })
  })
})
