import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveIdentityDisplayName, resolveIdentityPhotoUrl } from './identity-resolution'

test('identity names resolve from workspace to account to provider to safe fallback', () => {
  assert.equal(resolveIdentityDisplayName({
    workspaceOverride: ' Workspace ',
    accountOverride: 'Account',
    providerName: 'Provider',
    email: 'person@example.com',
  }), 'Workspace')
  assert.equal(resolveIdentityDisplayName({
    workspaceOverride: ' ',
    accountOverride: 'Account',
    providerName: 'Provider',
  }), 'Account')
  assert.equal(resolveIdentityDisplayName({
    providerName: 'Provider',
    legacyDisplayName: 'Legacy',
  }), 'Provider')
  assert.equal(resolveIdentityDisplayName({ legacyDisplayName: 'Legacy' }), 'Legacy')
  assert.equal(resolveIdentityDisplayName({}), 'User')
})

test('identity photos resolve from workspace to account to provider', () => {
  assert.equal(resolveIdentityPhotoUrl({
    workspacePhotoUrl: '/workspace-photo',
    accountPhotoUrl: '/account-photo',
    providerPhotoUrl: '/provider-photo',
  }), '/workspace-photo')
  assert.equal(resolveIdentityPhotoUrl({ accountPhotoUrl: '/account-photo', providerPhotoUrl: '/provider-photo' }), '/account-photo')
  assert.equal(resolveIdentityPhotoUrl({ providerPhotoUrl: '/provider-photo' }), '/provider-photo')
  assert.equal(resolveIdentityPhotoUrl({}), null)
})
