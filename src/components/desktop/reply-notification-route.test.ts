import assert from 'node:assert/strict'
import test from 'node:test'
import { captureReplyDestination, resolveReplyDestination } from './reply-notification-route'
import { methodSchemas } from '@overlay/desktop-bridge'

test('saved reply destinations retain their original workspace and personal view', () => {
  const destination = captureReplyDestination('original-workspace', '/w/old/personal/chat?id=old&surface=panel', 'saved-chat')!
  assert.equal(destination.route, '/app/w/original-workspace/chat?view=personal&id=saved-chat')
  assert.equal(methodSchemas['notifications.show'].safeParse({title:'Reply',body:'Done',route:destination.route}).success,true)
  // Resolving after navigation uses the captured destination, not the new workspace.
  assert.equal(resolveReplyDestination(destination.base,'later-chat'),'/app/w/original-workspace/chat?view=personal&id=later-chat')
})
test('first replies wait for persistence and never link a pending marker', () => {
  const destination = captureReplyDestination('original-workspace', '/app/chat?view=workspace-chats', '__overlay_pending_first_chat__')!
  assert.equal(destination.route,null)
  assert.equal(resolveReplyDestination(destination.base,'real-chat'),'/app/w/original-workspace/chat?view=workspace-chats&id=real-chat')
  assert.equal(resolveReplyDestination(destination.base,'__overlay_pending_first_chat__'),null)
})
test('temporary replies have no saved-chat notification destination', () => {
  assert.equal(captureReplyDestination('workspace', '/app/chat', '__overlay_temporary_chat__'),null)
})
