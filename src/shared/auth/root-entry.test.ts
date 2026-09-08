import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ROOT_APP_DESTINATION,
  classifyRootSessionResponse,
  resolveRootEntryDestination,
} from './root-entry'

test('authenticated root sessions enter the real app', () => {
  assert.equal(ROOT_APP_DESTINATION, '/app/agents')
  assert.equal(
    resolveRootEntryDestination(classifyRootSessionResponse({
      ok: true,
      authenticated: true,
      hasUser: true,
    })),
    ROOT_APP_DESTINATION,
  )
})

test('confirmed signed-out root sessions enter the marketing home', () => {
  assert.equal(
    resolveRootEntryDestination(classifyRootSessionResponse({
      ok: true,
      authenticated: false,
      hasUser: false,
    })),
    '/home',
  )
})

test('transient session failures are never classified as guests', () => {
  assert.equal(
    classifyRootSessionResponse({
      ok: false,
      authenticated: false,
      hasUser: false,
    }),
    'transient-error',
  )
  assert.equal(resolveRootEntryDestination('transient-error'), null)
})

test('an incomplete authenticated payload is treated as signed out', () => {
  assert.equal(
    classifyRootSessionResponse({
      ok: true,
      authenticated: true,
      hasUser: false,
    }),
    'unauthenticated',
  )
})
