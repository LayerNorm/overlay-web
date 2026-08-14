import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APP_DATA_MINIMUM_SCHEMA_VERSION,
  APP_DATA_SCHEMA_VERSION,
  evaluateAppDataSchemaCompatibility,
} from './schema-compatibility'

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

test('current schema rejects the previous runtime after the delta-table retirement boundary', () => {
  const previousRuntimeMaximum = APP_DATA_SCHEMA_VERSION - 1
  assert.equal(
    evaluateAppDataSchemaCompatibility({
      databaseMinimumRuntimeVersion: APP_DATA_MINIMUM_SCHEMA_VERSION,
      databaseSchemaVersion: APP_DATA_SCHEMA_VERSION,
      runtimeMaximumSchemaVersion: previousRuntimeMaximum,
      runtimeMinimumSchemaVersion: APP_DATA_MINIMUM_SCHEMA_VERSION - 1,
    }).compatible,
    false,
  )
})
