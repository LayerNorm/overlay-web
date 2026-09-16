import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS,
  MANAGED_HARNESS_IDS,
  isManagedHarnessId,
} from '@overlay/workspace-contracts'
import { getModel } from '@/shared/ai/gateway/model-data'
import {
  MANAGED_HARNESS_CATALOG,
  managedHarnessCatalogIsComplete,
  managedHarnessEntry,
  managedHarnessModelOption,
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

test('every catalog entry offers at least one model with a priced billing id', () => {
  for (const entry of MANAGED_HARNESS_CATALOG) {
    assert.ok(entry.models.length > 0, `${entry.id} needs a default model option`)
    for (const model of entry.models) {
      assert.ok(model.value.length > 0, `${entry.id} model needs a picker value`)
      assert.ok(model.label.length > 0, `${entry.id} model needs a label`)
      assert.ok(model.billingModelId.length > 0, `${entry.id} model ${model.value} needs a priced billingModelId`)
      // The billing id must resolve in the gateway catalog — a typo here would
      // silently mis-price or break the usage reservation at dispatch.
      assert.ok(getModel(model.billingModelId), `${entry.id} model ${model.value} billingModelId ${model.billingModelId} must exist in AVAILABLE_MODELS`)
    }
    // Picker values must be unique inside an entry.
    assert.equal(new Set(entry.models.map((model) => model.value)).size, entry.models.length)
  }
})

test('managedHarnessModelOption resolves picks and falls back to the entry default', () => {
  assert.equal(managedHarnessModelOption('claude-code', 'opus')?.harnessModel, 'opus')
  assert.equal(managedHarnessModelOption('claude-code', 'opus')?.billingModelId, 'anthropic/claude-opus-4.7')
  // Unknown or absent picks land on the first catalog entry — the default,
  // which is the highest-quality model like every other Overlay model picker.
  assert.equal(managedHarnessModelOption('claude-code', 'nonsense')?.value, 'opus')
  assert.equal(managedHarnessModelOption('claude-code')?.value, 'opus')
  assert.equal(managedHarnessModelOption('codex')?.value, 'default')
  assert.equal(managedHarnessModelOption('not-a-harness'), undefined)
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
