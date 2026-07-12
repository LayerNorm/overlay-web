import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateAppDataSchemaCompatibility } from './schema-compatibility'

test('schema compatibility permits a one-release rolling upgrade and rollback window', () => {
  assert.equal(
    evaluateAppDataSchemaCompatibility({
      databaseMinimumRuntimeVersion: 9,
      databaseSchemaVersion: 10,
      runtimeMaximumSchemaVersion: 10,
      runtimeMinimumSchemaVersion: 9,
    }).compatible,
    true,
  )
  assert.equal(
    evaluateAppDataSchemaCompatibility({
      databaseMinimumRuntimeVersion: 9,
      databaseSchemaVersion: 10,
      runtimeMaximumSchemaVersion: 9,
      runtimeMinimumSchemaVersion: 8,
    }).compatible,
    true,
  )
})

test('schema compatibility rejects runtimes older than the database minimum', () => {
  assert.equal(
    evaluateAppDataSchemaCompatibility({
      databaseMinimumRuntimeVersion: 9,
      databaseSchemaVersion: 10,
      runtimeMaximumSchemaVersion: 8,
      runtimeMinimumSchemaVersion: 7,
    }).compatible,
    false,
  )
})

test('schema compatibility rejects a database older than the runtime minimum', () => {
  assert.equal(
    evaluateAppDataSchemaCompatibility({
      databaseMinimumRuntimeVersion: 8,
      databaseSchemaVersion: 8,
      runtimeMaximumSchemaVersion: 10,
      runtimeMinimumSchemaVersion: 9,
    }).compatible,
    false,
  )
})
