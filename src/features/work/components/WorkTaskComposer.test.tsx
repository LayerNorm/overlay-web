import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { WorkItem } from '@overlay/app-core'
import { WorkTaskComposerForm } from './WorkTaskComposer'
import { ComposerAssignee, ComposerDependencies, ComposerSchedule } from './WorkComposerPickers'
import { WorkComposerContext } from './WorkComposerContext'

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

test('Enter submits, duplicate submits are held, success resets and refocuses; failures retain the draft', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { value: {}, configurable: true })
  let renderer: ReactTestRenderer
  let focuses = 0
  let resolve: (value: WorkItem | null) => void = () => undefined
  const requests: unknown[] = []
  const createTask = (input: unknown) => { requests.push(input); return new Promise<WorkItem | null>(done => { resolve = done }) }
  const node = { style: {}, scrollHeight: 40, getBoundingClientRect: () => ({ width: 500 }), focus: () => { focuses++ } }
  try {
    await act(async () => { renderer = create(<WorkTaskComposerForm scope="personal" principalId="me" people={[]} tasks={[]} createTask={createTask} />, { createNodeMock: element => element.type === 'textarea' ? node : null }) })
    const input = () => renderer!.root.findByType('textarea')
    const send = () => renderer!.root.findByProps({ 'aria-label': 'Add task' })
    assert.equal(send().props.disabled, true)
    await act(async () => {
      renderer!.root.findByType(ComposerAssignee).props.onChange('agent')
      renderer!.root.findByType(ComposerSchedule).props.onChange({ startDate: '2026-11-01', dueDate: '2026-11-03' })
      renderer!.root.findByType(ComposerDependencies).props.onChange(['blocker'])
      renderer!.root.findByType(WorkComposerContext).props.onAdd({ type: 'link', id: 'https://example.com/', label: 'Example' })
      renderer!.root.findByProps({ 'aria-label': 'Task settings' }).props.onClick()
    })
    await act(async () => { renderer!.root.findAllByType('button').find(button => button.props.children === 'Backlog')!.props.onClick() })
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
    assert.equal(renderer!.root.findByProps({ 'aria-label': 'Task settings' }).props['aria-expanded'], false)
    await act(async () => { input().props.onChange({ target: { value: 'Keep this' } }) })
    await act(async () => { input().props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: {}, preventDefault() { prevented = true } }) })
    assert.equal(prevented, true)
    await act(async () => { resolve(null) })
    assert.equal(input().props.value, 'Keep this')
    assert.ok(renderer!.root.findByProps({ role: 'alert' }))
    await act(async () => { renderer!.unmount() })
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
