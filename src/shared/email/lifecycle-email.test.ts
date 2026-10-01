import assert from 'node:assert/strict'
import test from 'node:test'
import { renderLifecycleEmail } from './lifecycle-email'

test('invitation email uses Overlay brand treatment', () => {
  const email = renderLifecycleEmail({
    name: 'workspace.invitation_sent',
    userId: 'user_1',
    idempotencyKey: 'invite-1',
    attributes: { workspaceName: 'Acme Corp', role: 'member' },
    resource: { id: 'inv_123' },
  }, 'https://getoverlay.io')

  assert.equal(email.subject, "You've been invited to Acme Corp on Overlay")
  assert.match(email.html, /background:#ffffff/)
  assert.match(email.html, /Libre Baskerville/)
  assert.match(email.html, /https:\/\/www\.getoverlay\.io\/assets\/overlay-logo\.png/)
  assert.match(email.html, />\s*overlay\s*</)
  assert.match(email.html, /Join Acme Corp/)
  assert.match(email.html, /Invited you as member/)
  assert.match(email.html, /Sign in with the email address that received this invitation/)
  assert.match(email.html, /\/app\/invitations\/inv_123/)
  assert.match(email.html, /background:#0a0a0a/)
})

test('notification emails link to email preferences, transactional ones do not', () => {
  const mention = renderLifecycleEmail({
    name: 'workspace.mention',
    userId: 'user_1',
    idempotencyKey: 'mention-1',
    attributes: {
      workspaceName: 'Acme Corp',
      conversationId: 'conv_1',
      conversationTitle: 'Launch plan',
      mentionedByDisplayName: 'Priya Shah',
    },
    resource: { id: 'mention_1' },
  }, 'https://getoverlay.io')
  assert.match(mention.html, /Manage email preferences/)
  assert.match(mention.html, /\/app\/chat\?view=channels&amp;id=conv_1/)

  const welcome = renderLifecycleEmail({
    name: 'user.created',
    userId: 'user_1',
    idempotencyKey: 'welcome-1',
    attributes: {},
    resource: { id: 'user_1' },
  }, 'https://getoverlay.io')
  assert.doesNotMatch(welcome.html, /Manage email preferences/)
})

test('automation failure email shows the automation name', () => {
  const email = renderLifecycleEmail({
    name: 'automation.failed',
    userId: 'user_1',
    idempotencyKey: 'automation-1',
    attributes: {
      execution: 'scheduled',
      automationName: 'Nightly summary',
      failureClass: 'provider',
    },
    resource: { id: 'run_1', automationId: 'auto_1' },
  }, 'https://getoverlay.io')

  assert.equal(email.subject, 'An Overlay automation needs attention')
  assert.match(email.html, /Nightly summary/)
  assert.match(email.html, /Scheduled run &middot; provider error/)
  assert.match(email.html, /\/app\/automations\?automationId=auto_1/)
})

test('email copy never contains em dashes', () => {
  const events = [
    { name: 'user.created', attributes: {}, resource: { id: 'u1' } },
    { name: 'subscription.changed', attributes: { status: 'active' }, resource: { id: 's1' } },
    { name: 'subscription.changed', attributes: { status: 'past_due' }, resource: { id: 's1' } },
    { name: 'subscription.changed', attributes: { status: 'canceled' }, resource: { id: 's1' } },
    { name: 'subscription.changed', attributes: { status: 'trialing' }, resource: { id: 's1' } },
    { name: 'subscription.changed', attributes: { status: 'unknown' }, resource: { id: 's1' } },
    { name: 'topup.succeeded', attributes: {}, resource: { id: 't1' } },
    {
      name: 'automation.failed',
      attributes: { execution: 'manual', automationName: 'Nightly summary', failureClass: 'provider' },
      resource: { id: 'r1', automationId: 'a1' },
    },
    { name: 'api_key.changed', attributes: { action: 'created' }, resource: { id: 'k1' } },
    { name: 'api_key.changed', attributes: { action: 'revoked' }, resource: { id: 'k1' } },
    { name: 'api_key.changed', attributes: { action: 'rotated' }, resource: { id: 'k1' } },
    {
      name: 'workspace.invitation_sent',
      attributes: { workspaceName: 'Acme Corp', role: 'admin' },
      resource: { id: 'i1' },
    },
    {
      name: 'workspace.mention',
      attributes: {
        workspaceName: 'Acme Corp',
        conversationId: 'c1',
        conversationTitle: 'Launch plan',
        mentionedByDisplayName: 'Priya Shah',
      },
      resource: { id: 'm1' },
    },
    {
      name: 'workspace.dm_received',
      attributes: { workspaceName: 'Acme Corp', conversationId: 'c2', fromDisplayName: 'Priya Shah' },
      resource: { id: 'd1' },
    },
  ] as const

  for (const event of events) {
    const email = renderLifecycleEmail(
      { ...event, userId: 'user_1', idempotencyKey: `key-${event.name}` },
      'https://getoverlay.io',
    )
    assert.doesNotMatch(email.subject, /[—–]|&m(dash|ndash);/, `${event.name} subject`)
    assert.doesNotMatch(email.text, /[—–]|&m(dash|ndash);/, `${event.name} text`)
    assert.doesNotMatch(email.html, /[—–]|&m(dash|ndash);/, `${event.name} html`)
  }
})
