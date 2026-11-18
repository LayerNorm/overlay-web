import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { WorkItem, WorkPerson } from '@overlay/app-core'
import { WorkTaskComposerForm, WorkTaskSettings } from './WorkTaskComposer'
import { PopoverContent } from '@overlay/ui/primitives'
import { emptyComposerDraft } from '../lib/composer-draft'
import { ComposerAssignee, ComposerDependencies, ComposerSchedule } from './WorkComposerPickers'
import { WorkComposerContext } from './WorkComposerContext'
import { Avatar } from './work-ui'

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

function mockTooltipGlobals() {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: { addEventListener() {}, removeEventListener() {} }, configurable: true })
  return () => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

test('compact pickers preserve accessible labels, avatars and counts, including empty and disabled states', async () => {
  const restoreGlobals = mockTooltipGlobals()
  const people: WorkPerson[] = [{ principalId: 'agent', type: 'agent', userId: null, displayName: 'Research agent', isDefault: true }]
  const props = { scope: 'personal' as const, principalId: 'me', people, tasks: [], createTask: async () => null, search: async () => [] }
  let renderer: ReactTestRenderer | undefined
  const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === label)!
  const badges = (label: string) => button(label).findAll(node => node.type === 'span' && node.props['aria-hidden'] === 'true')
  try {
    await act(async () => { renderer = create(<WorkTaskComposerForm {...props} />) })
    const footer = renderer!.root.findAll(node => node.type === 'div' && node.props['data-slot'] === 'prompt-input-footer')[0]
    assert.match(footer.props.className, /flex-nowrap/)
    assert.doesNotMatch(footer.props.className, /\bflex-wrap\b/)
    assert.equal(renderer!.root.findAllByType('div').some(node => node.props.className?.includes('@container/work-composer')), true)
    for (const label of ['Assignee', 'Schedule', 'Depends on']) {
      assert.match(button(label).props.className, /@max-\[520px\]\/work-composer:w-8/)
      assert.match(button(label).props.className, /@max-\[520px\]\/work-composer:px-0/)
      assert.equal(button(label).findAllByType('span').some(node => node.props.className?.includes('@max-[520px]/work-composer:sr-only') && node.props.children === label), true)
      assert.equal(badges(label).length, 0)
    }
    await act(async () => {
      renderer!.root.findByType(ComposerAssignee).props.onChange('agent')
      renderer!.root.findByType(ComposerSchedule).props.onChange({ startDate: '2026-11-01', dueDate: '2026-11-03' })
      renderer!.root.findByType(ComposerDependencies).props.onChange(['a', 'b', 'c'])
    })
    assert.equal(button('Research agent').findByType(Avatar).props.size, 16)
    assert.equal(badges('Schedule (2)')[0].props.children, 2)
    assert.equal(badges('Depends on (3)')[0].props.children, 3)
    const hint = renderer!.root.findAllByType('span').find(node => node.props.children === 'Starts when dependencies finish')!
    assert.match(hint.props.className, /@max-\[520px\]\/work-composer:hidden/)
    await act(async () => { renderer!.update(<WorkTaskComposerForm {...props} disabled />) })
    for (const label of ['Research agent', 'Schedule (2)', 'Depends on (3)']) assert.equal(button(label).props.disabled, true)
  } finally {
    await act(async () => { renderer?.unmount() })
    restoreGlobals()
  }
})

test('Enter submits, duplicate submits are held, failures remain retryable without blocking the composer', async () => {
  const restoreGlobals = mockTooltipGlobals()
  let renderer: ReactTestRenderer
  let focuses = 0
  let resolve: (value: WorkItem | null) => void = () => undefined
  const requests: unknown[] = []
  const createTask = (input: unknown) => { requests.push(input); return new Promise<WorkItem | null>(done => { resolve = done }) }
  const node = { style: {}, scrollHeight: 40, getBoundingClientRect: () => ({ width: 500 }), focus: () => { focuses++ } }
  try {
    await act(async () => { renderer = create(<WorkTaskComposerForm scope="personal" principalId="me" people={[]} tasks={[]} createTask={createTask} search={async () => []} />, { createNodeMock: element => element.type === 'textarea' ? node : null }) })
    const input = () => renderer!.root.findByType('textarea')
    const send = () => renderer!.root.findByProps({ 'aria-label': 'Add task' })
    assert.equal(send().props.disabled, true)
    await act(async () => {
      renderer!.root.findByType(ComposerAssignee).props.onChange('agent')
      renderer!.root.findByType(ComposerSchedule).props.onChange({ startDate: '2026-11-01', dueDate: '2026-11-03' })
      renderer!.root.findByType(ComposerDependencies).props.onChange(['blocker'])
      renderer!.root.findByType(WorkComposerContext).props.onAdd({ type: 'link', id: 'https://example.com/', label: 'Example' })
      const content = renderer!.root.findAllByType(PopoverContent).find(node => node.props['aria-label'] === 'Task settings')!
      content.props.children.props.onChange({ status: 'backlog' })
    })
    await act(async () => { input().props.onChange({ target: { value: 'Title\nDescription' } }) })
    let prevented = false
    await act(async () => { input().props.onKeyDown({ key: 'Enter', shiftKey: true, nativeEvent: {}, preventDefault() { prevented = true } }) })
    assert.equal(requests.length, 0)
    assert.equal(prevented, false)
    await act(async () => { input().props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true }, preventDefault() {} }) })
    assert.equal(requests.length, 0)
    await act(async () => { send().props.onClick(); send().props.onClick() })
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0], { title: 'Title', description: 'Description', status: 'backlog', priority: 2, blockedBy: ['blocker'], assigneePrincipalId: 'agent', startDate: '2026-11-01', dueDate: '2026-11-03', context: [{ type: 'link', id: 'https://example.com/', label: 'Example' }] })
    assert.equal(input().props.value, '', 'clears before the server answers')
    await act(async () => { resolve({ id: 'created' } as WorkItem) })
    assert.equal(input().props.value, '')
    assert.equal(send().props.disabled, true)
    assert.equal(focuses, 1)
    assert.equal(renderer!.root.findByType(ComposerAssignee).props.value, '')
    assert.deepEqual(renderer!.root.findByType(ComposerDependencies).props.value, [])
    assert.equal(renderer!.root.findByType(ComposerSchedule).props.draft.startDate, '')
    assert.equal(renderer!.root.findByType(ComposerSchedule).props.draft.dueDate, '')
    assert.equal(renderer!.root.findByType(ComposerSchedule).props.draft.status, 'todo')
    assert.equal(renderer!.root.findByType(ComposerSchedule).props.draft.priority, 2)
    assert.deepEqual(renderer!.root.findByType(ComposerSchedule).props.draft.context, [])
    assert.equal(renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === 'Task settings')!.props['aria-expanded'], false)
    await act(async () => { input().props.onChange({ target: { value: 'Keep this' } }) })
    await act(async () => { input().props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: {}, preventDefault() { prevented = true } }) })
    assert.equal(prevented, true)
    assert.equal(input().props.value, '')
    await act(async () => { resolve(null) })
    assert.equal(input().props.value, '')
    const message = () => renderer!.root.findByProps({ role: 'alert' }).children.join('')
    assert.equal(message(), 'Couldn’t add “Keep this”. Retry with your saved draft and settings.')
    const retry = () => renderer!.root.findAllByType('button').find(button => button.props['aria-label']?.endsWith('Keep this'))!
    await act(async () => { retry().props.onClick(); retry().props.onClick() })
    assert.equal(requests.length, 3, 'a pending retry cannot be duplicated')
    assert.deepEqual(requests[2], { title: 'Keep this', status: 'todo', priority: 2, blockedBy: [], context: [] })
    assert.equal(retry().props.disabled, true)
    await act(async () => { resolve(null) })
    assert.equal(requests.length, 3)
    assert.equal(retry().props.disabled, false, 'a failed retry can be attempted again')
    await act(async () => { retry().props.onClick() })
    assert.equal(requests.length, 4)
    await act(async () => { resolve({ id: 'retry-success' } as WorkItem) })
    assert.equal(renderer!.root.findAllByProps({ role: 'alert' }).length, 0)
    await act(async () => { renderer!.unmount() })
  } finally {
    restoreGlobals()
  }
})

test('concurrent failures retain every setting and do not overwrite a settings-only draft', async () => {
  const restoreGlobals = mockTooltipGlobals()
  let renderer: ReactTestRenderer
  const requests: unknown[] = []
  const resolvers: Array<(value: WorkItem | null) => void> = []
  const createTask = (input: unknown) => {
    requests.push(input)
    return new Promise<WorkItem | null>(resolve => { resolvers.push(resolve) })
  }
  const people: WorkPerson[] = ['agent-a', 'agent-b', 'agent-current'].map(principalId => ({
    principalId, type: 'agent' as const, userId: null, displayName: principalId,
  }))
  const contextA = { type: 'link' as const, id: 'https://example.com/a', label: 'Context A' }
  const contextB = { type: 'link' as const, id: 'https://example.com/b', label: 'Context B' }
  const currentContext = { type: 'link' as const, id: 'https://example.com/current', label: 'Current context' }
  const props = { scope: 'personal' as const, principalId: 'me', people, tasks: [], createTask, search: async () => [] }
  const input = () => renderer!.root.findByType('textarea')
  const settings = () => renderer!.root.findAllByType(PopoverContent).find(node => node.props['aria-label'] === 'Task settings')!.props.children
  const submit = () => renderer!.root.findByProps({ 'aria-label': 'Add task' }).props.onClick()
  const retry = (title: string) => renderer!.root.findAllByType('button').find(button => button.props['aria-label'] === `Retry ${title}`)!
  try {
    await act(async () => { renderer = create(<WorkTaskComposerForm {...props} />) })
    await act(async () => {
      input().props.onChange({ target: { value: 'Failed A\nDescription A' } })
      renderer!.root.findByType(ComposerAssignee).props.onChange('agent-a')
      renderer!.root.findByType(ComposerSchedule).props.onChange({ startDate: '2026-11-01', dueDate: '2026-11-04' })
      renderer!.root.findByType(ComposerDependencies).props.onChange(['dependency-a'])
      renderer!.root.findByType(WorkComposerContext).props.onAdd(contextA)
      settings().props.onChange({ status: 'backlog', priority: 1 })
    })
    await act(async () => { submit() })
    await act(async () => {
      input().props.onChange({ target: { value: 'Failed B\nDescription B' } })
      renderer!.root.findByType(ComposerAssignee).props.onChange('agent-b')
      renderer!.root.findByType(ComposerSchedule).props.onChange({ startDate: '2026-12-01', dueDate: '2026-12-05' })
      renderer!.root.findByType(ComposerDependencies).props.onChange(['dependency-b'])
      renderer!.root.findByType(WorkComposerContext).props.onAdd(contextB)
      settings().props.onChange({ status: 'todo', priority: 3 })
    })
    await act(async () => { submit() })
    await act(async () => {
      renderer!.root.findByType(ComposerAssignee).props.onChange('agent-current')
      renderer!.root.findByType(ComposerSchedule).props.onChange({ startDate: '2026-12-10', dueDate: '' })
      renderer!.root.findByType(ComposerDependencies).props.onChange(['current-dependency'])
      renderer!.root.findByType(WorkComposerContext).props.onAdd(currentContext)
      settings().props.onChange({ status: 'backlog', priority: 1 })
    })
    assert.deepEqual(requests.slice(0, 2), [
      { title: 'Failed A', description: 'Description A', status: 'backlog', priority: 1, blockedBy: ['dependency-a'], assigneePrincipalId: 'agent-a', startDate: '2026-11-01', dueDate: '2026-11-04', context: [contextA] },
      { title: 'Failed B', description: 'Description B', status: 'todo', priority: 3, blockedBy: ['dependency-b'], assigneePrincipalId: 'agent-b', startDate: '2026-12-01', dueDate: '2026-12-05', context: [contextB] },
    ])
    await act(async () => { resolvers[0]!(null) })
    await act(async () => { resolvers[1]!(null) })
    assert.equal(input().props.value, '')
    assert.equal(renderer!.root.findByType(ComposerAssignee).props.value, 'agent-current')
    assert.deepEqual(renderer!.root.findByType(ComposerDependencies).props.value, ['current-dependency'])
    assert.equal(renderer!.root.findByType(ComposerSchedule).props.draft.startDate, '2026-12-10')
    assert.equal(renderer!.root.findByType(ComposerSchedule).props.draft.status, 'backlog')
    assert.equal(renderer!.root.findByType(ComposerSchedule).props.draft.priority, 1)
    assert.ok(renderer!.root.findByProps({ 'aria-label': 'Remove Current context' }))
    assert.equal(renderer!.root.findAllByProps({ role: 'alert' }).length, 2)
    assert.ok(renderer!.root.findAllByProps({ role: 'alert' }).every(message => message.children.join('').includes('Retry with your saved draft and settings.')))
    const retryA = retry('Failed A')
    const retryB = retry('Failed B')
    await act(async () => {
      retryA.props.onClick()
      retryA.props.onClick()
      retryB.props.onClick()
    })
    assert.equal(requests.length, 4, 'both failed tasks retry, while duplicate clicks on one pending retry are ignored')
    assert.deepEqual(requests[2], requests[0])
    assert.deepEqual(requests[3], requests[1])
    await act(async () => {
      resolvers[2]!({ id: 'retry-a' } as WorkItem)
      resolvers[3]!({ id: 'retry-b' } as WorkItem)
    })
    assert.equal(renderer!.root.findAllByProps({ role: 'alert' }).length, 0)
    assert.equal(renderer!.root.findByType(ComposerAssignee).props.value, 'agent-current')
    await act(async () => { renderer!.unmount() })
  } finally {
    restoreGlobals()
  }
})

test('task settings preserve status and priority selections with accessible controls', async () => {
  const patches: unknown[] = []
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<WorkTaskSettings draft={emptyComposerDraft()} onChange={patch => patches.push(patch)} />) })
  const buttons = () => renderer.root.findAllByType('button')
  assert.equal(buttons().find(button => button.props.children === 'Todo')!.props['aria-pressed'], true)
  await act(async () => { buttons().find(button => button.props.children === 'Backlog')!.props.onClick() })
  assert.deepEqual(patches, [{ status: 'backlog' }])
  await act(async () => { renderer.update(<WorkTaskSettings draft={{ ...emptyComposerDraft(), status: 'backlog' }} disabled onChange={() => undefined} />) })
  assert.equal(buttons().find(button => button.props.children === 'Backlog')!.props['aria-pressed'], true)
  assert.ok(buttons().every(button => button.props.disabled))
  await act(async () => { renderer.unmount() })
})
