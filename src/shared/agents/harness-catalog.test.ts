import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS,
  MANAGED_HARNESS_IDS,
  isManagedHarnessId,
} from '@overlay/workspace-contracts'
import {
  MANAGED_HARNESS_CATALOG,
  managedHarnessCatalogIsComplete,
  managedHarnessEntry,
} from './harness-catalog'

test('managed harness catalog covers every MANAGED_HARNESS_IDS entry exactly once', () => {
  assert.equal(managedHarnessCatalogIsComplete(), true)
  assert.equal(MANAGED_HARNESS_CATALOG.length, MANAGED_HARNESS_IDS.length)
  assert.deepEqual(
    [...MANAGED_HARNESS_CATALOG.map((entry) => entry.id)].sort(),
    [...MANAGED_HARNESS_IDS].sort(),
  )
})

test('catalog entries carry presentation metadata and coherent kinds', () => {
  for (const entry of MANAGED_HARNESS_CATALOG) {
    assert.ok(entry.label.length > 0, `${entry.id} needs a label`)
    assert.ok(entry.description.length > 0, `${entry.id} needs a description`)
    if (entry.kind === 'host') {
      assert.equal(entry.requiresSandboxPort, false, `${entry.id} host adapters do not need a bridge port`)
    } else {
      assert.equal(entry.requiresSandboxPort, true, `${entry.id} ${entry.kind} adapters need a bridge port`)
    }
  }
})

test('managedHarnessEntry resolves by id and ignores unknown ids', () => {
  assert.equal(managedHarnessEntry('claude-code')?.kind, 'bridge')
  assert.equal(managedHarnessEntry('pi')?.kind, 'host')
  assert.equal(managedHarnessEntry('hermes')?.kind, 'acp')
  assert.equal(managedHarnessEntry('openclaw'), undefined)
  assert.equal(managedHarnessEntry('overlay'), undefined)
})

test('isManagedHarnessId guards the allowlist', () => {
  for (const id of MANAGED_HARNESS_IDS) {
    assert.equal(isManagedHarnessId(id), true)
  }
  assert.equal(isManagedHarnessId('overlay'), false)
  assert.equal(isManagedHarnessId('openclaw'), false)
  assert.equal(isManagedHarnessId(''), false)
  assert.equal(isManagedHarnessId(undefined), false)
  assert.equal(isManagedHarnessId(42), false)
})

test('managed harness ids stay separate from the user-owned ACP allowlist semantics', () => {
  // Overlapping ids are fine (a harness may exist on both surfaces); the lists
  // must remain independent declarations so enabling one side never implies
  // the other. Guard the shape: both must remain readonly string lists.
  for (const id of MANAGED_HARNESS_IDS) {
    assert.equal(typeof id, 'string')
  }
  for (const id of BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS) {
    assert.equal(typeof id, 'string')
  }
})
