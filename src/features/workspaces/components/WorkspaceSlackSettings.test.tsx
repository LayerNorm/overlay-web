import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { Button, Popover } from '@overlay/ui/primitives'
import { WorkspaceSlackContent } from './WorkspaceSlackSettings'
import type { WorkspaceSlackController } from './use-workspace-slack'

const require = createRequire(import.meta.url)
const { create } = require('react-test-renderer') as typeof import('react-test-renderer')

function controller(canManage = true, linked = true): WorkspaceSlackController {
  return {
    data: {
      connections: [{ id: 'conn', workspaceId: 'ws', platform: 'slack', externalTeamId: 'T1', externalTeamName: 'LayerNorm', externalEnterpriseId: null, botUserId: 'BOT', status: 'active', installedByUserId: 'admin', createdAt: 1, updatedAt: 1 }],
      bindings: [{ id: 'binding', connectionId: 'conn', agentId: 'chief', channelId: 'C1', channelName: 'general', status: 'active', createdByUserId: 'admin', createdAt: 1, updatedAt: 1 }],
      canManage,
      identityLinks: linked ? [{ id: 'my-link', connectionId: 'conn', slackUserId: 'U_ME' }] : [],
    },
    picker: null, busy: null, error: null,
    connect() {}, link() {}, closePicker() {},
    async openPicker() {}, async addChannel() {},
    async removeChannel() { return true }, async disconnect() { return true }, async unlink() { return true },
  }
}

function render(value: WorkspaceSlackController) {
  return renderToStaticMarkup(<WorkspaceSlackContent controller={value} />)
}

test('admins manage public channels and the connection; members see read-only rows and their own account', () => {
  const admin = render(controller())
  for (const label of ['LayerNorm', 'Overlay bot · Workspace Chief', 'Enabled public channels', 'general', 'Add channel', 'Remove #general', 'Disconnect', 'Linked as U_ME', 'Unlink', '/assets/svg/landing/slack.svg']) assert.ok(admin.includes(label), label)
  assert.match(admin, /DMs, private channels and Slack Connect aren’t supported yet/)
  const member = render(controller(false))
  assert.match(member, /LayerNorm/)
  assert.match(member, /general/)
  assert.match(member, /Linked as U_ME/)
  assert.match(member, /Unlink/)
  assert.doesNotMatch(member, /Add channel|Remove #|Disconnect|Connect Slack/)
})

test('only admins can connect, while unlinked members can link their personal account', () => {
  const admin = controller()
  admin.data!.connections = []
  assert.match(render(admin), /Connect Slack/)
  admin.data!.canManage = false
  assert.match(render(admin), /Ask a workspace administrator/)
  assert.doesNotMatch(render(admin), /<button/)
  const member = render(controller(false, false))
  assert.match(member, /Link your Slack account/)
  assert.doesNotMatch(member, />Unlink<|Linked as/)
})

test('linked accounts show the stored handle and legacy links fall back to their Slack ID', () => {
  const value = controller(false)
  value.data!.identityLinks[0].displayName = 'dana'
  assert.match(render(value), /Linked as @dana/)
  assert.doesNotMatch(render(value), /U_ME/)
  delete value.data!.identityLinks[0].displayName
  assert.match(render(value), /Linked as U_ME/)
})

test('empty channels, loading and unavailable access are distinct from successful connection data', () => {
  const empty = controller()
  empty.data!.bindings = []
  assert.match(render(empty), /No channels enabled\. Add a public channel/)
  empty.data!.canManage = false
  assert.match(render(empty), /No public channels are enabled yet/)
  assert.match(render({ ...empty, data: undefined }), /Loading Slack connection/)
  assert.match(render({ ...empty, data: null }), /Could not load Slack settings/)
  assert.doesNotMatch(render({ ...empty, data: null }), /Connect Slack|Link your Slack account/)
  assert.match(render({ ...empty, error: 'Request failed' }), /role="alert"[^>]*>Request failed/)
})

test('disconnect requires confirmation, cancellation does not delete, and failed deletion remains retryable', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const value = controller()
  const calls: string[] = []
  let success = false
  value.disconnect = async id => { calls.push(id); return success }
  let renderer!: ReturnType<typeof create>
  try {
    await act(async () => { renderer = create(<WorkspaceSlackContent controller={value} />) })
    const disconnect = () => renderer.root.findAllByType(Button).find(button => button.props.children === 'Disconnect')!
    await act(async () => { disconnect().props.onClick() })
    assert.deepEqual(calls, [])
    assert.equal(renderer.root.findByType(ConfirmDialog).props.isOpen, true)
    await act(async () => { renderer.root.findByType(ConfirmDialog).props.onCancel() })
    assert.equal(renderer.root.findByType(ConfirmDialog).props.isOpen, false)
    assert.deepEqual(calls, [])
    await act(async () => { disconnect().props.onClick() })
    await act(async () => { await renderer.root.findByType(ConfirmDialog).props.onConfirm() })
    assert.deepEqual(calls, ['conn'])
    assert.equal(renderer.root.findByType(ConfirmDialog).props.isOpen, true)
    success = true
    await act(async () => { await renderer.root.findByType(ConfirmDialog).props.onConfirm() })
    assert.equal(renderer.root.findByType(ConfirmDialog).props.isOpen, false)
    assert.deepEqual(calls, ['conn', 'conn'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('personal link and channel actions target their connection and persisted binding', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const value = controller(false, false)
  const linked: string[] = []
  value.link = id => { linked.push(id) }
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<WorkspaceSlackContent controller={value} />) })
  const link = renderer.root.findAllByType(Button).find(button => button.props.children === 'Link your Slack account')!
  await act(async () => link.props.onClick())
  assert.deepEqual(linked, ['conn'])
  await act(async () => renderer.unmount())
  const admin = controller()
  const opened: string[] = []
  const removed: string[] = []
  admin.openPicker = async id => { opened.push(id) }
  admin.removeChannel = async id => { removed.push(id); return true }
  await act(async () => { renderer = create(<WorkspaceSlackContent controller={admin} />) })
  await act(async () => renderer.root.findByType(Popover).props.onOpenChange(true))
  assert.deepEqual(opened, ['conn'])
  await act(async () => renderer.root.findAllByType(Button).find(button => button.props['aria-label'] === 'Remove #general')!.props.onClick())
  assert.deepEqual(removed, ['binding'])
  await act(async () => renderer.unmount())
})
