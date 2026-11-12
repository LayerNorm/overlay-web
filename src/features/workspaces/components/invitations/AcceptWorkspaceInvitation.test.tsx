import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceInvitationPreviewResponse } from '@overlay/workspace-contracts'
import { InvitationPreviewCard } from './AcceptWorkspaceInvitation'

const preview: WorkspaceInvitationPreviewResponse = {
  status: 'pending', workspaceName: 'Acme', inviterName: 'Priya Shah',
  role: 'member', invitedEmail: 'dev@acme.com', workspaceBilling: 'paid',
}
function render(overrides: Partial<React.ComponentProps<typeof InvitationPreviewCard>> = {}) {
  return renderToStaticMarkup(<InvitationPreviewCard preview={preview} authLoading={false} signedIn={false}
    busy={false} error={null} accept={async () => {}} switchAccount={async () => {}}
    invitePath="/app/invitations/invite_1" signInHref="/auth/sign-in?redirect=%2Fapp%2Finvitations%2Finvite_1" {...overrides} />)
}

test('signed-out card has signup with email, sign-in with invitation redirect, and paid context', () => {
  const html = render()
  for (const copy of ['Join Acme', 'Priya Shah', 'dev@acme.com', 'Create account', 'I already have an account', 'New to Overlay?', 'Acme is on a paid plan. Tasks use the workspace budget.']) assert.ok(html.includes(copy), copy)
  assert.match(html, /sign-up\?redirect=%2Fapp%2Finvitations%2Finvite_1&amp;email=dev%40acme.com/)
  assert.doesNotMatch(html, /Accept and continue|Switch account/)
})

test('email comparison is case insensitive and mismatched account never offers accept', () => {
  assert.match(render({ signedIn: true, userEmail: 'DEV@ACME.COM' }), /Accept and continue/)
  const html = render({ signedIn: true, userEmail: 'other@acme.com' })
  assert.match(html, /Switch account/)
  assert.match(html, /This invitation was sent to/)
  assert.match(html, /other@acme.com/)
  assert.doesNotMatch(html, /Accept and continue|Create account/)
})

test('free members and admins receive different billing context', () => {
  assert.match(render({ preview: { ...preview, workspaceBilling: 'free' } }), /once an owner or admin subscribes/)
  const html = render({ preview: { ...preview, workspaceBilling: 'free', role: 'admin' } })
  assert.match(html, /You can subscribe during setup/)
  assert.doesNotMatch(html, /once an owner or admin subscribes/)
})

test('loading, auth loading, not-found, and errors offer no wrong action or premature billing', () => {
  for (const loadError of [undefined, 'Invitation not found', 'Could not load this invitation. Please try again.']) {
    const html = render({ preview: undefined, loadError })
    assert.doesNotMatch(html, /paid plan|activated billing|Accept and continue|Create account/)
    assert.ok(html.includes(loadError ?? 'Loading invitation...'))
  }
  assert.doesNotMatch(render({ authLoading: true }), /Accept and continue|Create account/)
  assert.match(render({ error: 'Could not sign out.' }), /role="alert"/)
  assert.match(render({ signedIn: true, userEmail: preview.invitedEmail, busy: true }), /disabled/)
})

test('non-pending states cannot be accepted and have no billing prompts', () => {
  for (const [status, message] of [
    ['expired', 'This invitation has expired'],
    ['cancelled', 'This invitation was cancelled'],
    ['accepted', 'This invitation has already been used'],
    ['replaced', 'A newer invitation was sent. Use the latest email.'],
  ] as const) {
    const html = render({ preview: { ...preview, status }, signedIn: true, userEmail: preview.invitedEmail })
    assert.ok(html.includes(message))
    assert.doesNotMatch(html, /Accept and continue|Create account|Switch account|paid plan|activated billing/)
  }
})
