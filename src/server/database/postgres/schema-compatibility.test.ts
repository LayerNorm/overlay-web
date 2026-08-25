import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import test from 'node:test'
import {
  APP_DATA_MINIMUM_SCHEMA_VERSION,
  APP_DATA_SCHEMA_VERSION,
  evaluateAppDataSchemaCompatibility,
} from './schema-compatibility'

test('runtime schema version matches the newest checked-in app-data migration', () => {
  const latestMigration = readdirSync('migrations/app-data')
    .map((name) => Number(name.match(/^(\d{4})_/)?.[1]))
    .filter(Number.isSafeInteger)
    .sort((left, right) => right - left)[0]
  assert.equal(APP_DATA_SCHEMA_VERSION, latestMigration)
})

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

test('current schema rejects pre-retirement runtimes after the delta-table boundary', () => {
  const preRetirementRuntimeMaximum = APP_DATA_MINIMUM_SCHEMA_VERSION - 1
  assert.equal(
    evaluateAppDataSchemaCompatibility({
      databaseMinimumRuntimeVersion: APP_DATA_MINIMUM_SCHEMA_VERSION,
      databaseSchemaVersion: APP_DATA_SCHEMA_VERSION,
      runtimeMaximumSchemaVersion: preRetirementRuntimeMaximum,
      runtimeMinimumSchemaVersion: APP_DATA_MINIMUM_SCHEMA_VERSION - 1,
    }).compatible,
    false,
  )
})
