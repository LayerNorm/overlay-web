import assert from 'node:assert/strict'
import test from 'node:test'
import { renderLifecycleEmail } from './lifecycle-email'

test('invitation email uses Overlay brand treatment', () => {
  const email = renderLifecycleEmail({
    name: 'workspace.invitation_sent',
    userId: 'user_1',
    idempotencyKey: 'invite-1',
    attributes: { workspaceName: 'Acme Corp' },
    resource: { id: 'inv_123' },
  }, 'https://getoverlay.io')

  assert.equal(email.subject, "You've been invited to Acme Corp on Overlay")
  assert.match(email.html, /background:#ffffff/)
  assert.doesNotMatch(email.html, /background:#f5f5f5/)
  assert.match(email.html, /Libre Baskerville/)
  assert.match(email.html, /https:\/\/www\.getoverlay\.io\/assets\/overlay-logo\.png/)
  assert.match(email.html, />\s*overlay\s*</)
  assert.match(email.html, /You&#39;re invited to Acme Corp/)
  assert.match(email.html, /Sign in with the email address that received this invitation/)
  assert.match(email.html, /\/app\/invitations\/inv_123/)
  assert.match(email.html, /background:#404040/)
})
