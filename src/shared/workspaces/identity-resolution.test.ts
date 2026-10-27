import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveIdentityDisplayName, resolveIdentityPhotoUrl, versionedIdentityUrl } from './identity-resolution'

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

test('uploaded media URLs change by UUID without exposing object keys', () => {
  const first = versionedIdentityUrl(
    '/api/profile/photo?userId=u1',
    'identity/accounts/u1/123e4567-e89b-12d3-a456-426614174000.webp',
  )
  const second = versionedIdentityUrl(
    '/api/profile/photo?userId=u1',
    'identity/accounts/u1/123e4567-e89b-12d3-a456-426614174001.webp',
  )
  assert.notEqual(first, second)
  assert.equal(first, '/api/profile/photo?userId=u1&v=123e4567-e89b-12d3-a456-426614174000')
  assert.equal(first.includes('identity/accounts'), false)
})
