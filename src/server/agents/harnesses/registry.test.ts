import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import { MANAGED_HARNESS_IDS } from '@overlay/workspace-contracts'
import { MANAGED_HARNESS_CATALOG } from '@/shared/agents/harness-catalog'
import {
  listManagedHarnessDescriptors,
  loadHarnessAdapter,
  managedHarnessDescriptor,
  createManagedHarnessAgent,
} from './registry'

test('every catalog harness has a descriptor, and descriptors match catalog metadata', () => {
  const descriptors = listManagedHarnessDescriptors()
  assert.equal(descriptors.length, MANAGED_HARNESS_IDS.length)
  for (const entry of MANAGED_HARNESS_CATALOG) {
    const descriptor = managedHarnessDescriptor(entry.id)
    assert.equal(descriptor.id, entry.id)
    assert.ok(descriptor.packageName.startsWith('@ai-sdk/'), `${entry.id} must load an @ai-sdk/* adapter`)
    if (entry.requiresSandboxPort) {
      assert.equal(typeof descriptor.bridgePort, 'number', `${entry.id} needs a bridge port`)
    } else {
      assert.equal(descriptor.bridgePort, undefined, `${entry.id} host adapters must not declare a bridge port`)
    }
  }
})

test('loadHarnessAdapter returns a harness-v1 adapter whose id matches the catalog entry', async () => {
  for (const id of MANAGED_HARNESS_IDS) {
    const adapter = await loadHarnessAdapter(id)
    assert.equal(adapter.specificationVersion, 'harness-v1', `${id} must implement harness-v1`)
    assert.equal(adapter.harnessId, id, `${id} adapter.harnessId should equal the catalog id`)
  }
})

test('managedHarnessDescriptor throws for ids outside the catalog', () => {
  assert.throws(() => managedHarnessDescriptor('openclaw' as never), /No managed harness descriptor/)
})

test('createManagedHarnessAgent builds a HarnessAgent without contacting a sandbox', async () => {
  const agent = await createManagedHarnessAgent({ harnessId: 'pi' })
  assert.equal(agent.version, 'agent-v1')
  assert.equal(typeof agent.createSession, 'function')
  assert.equal(typeof agent.stream, 'function')
  assert.equal(typeof agent.generate, 'function')
  await assert.rejects(
    createManagedHarnessAgent({ harnessId: 'openclaw' as never }),
    /Unknown managed harness/,
  )
})

test('catalog byokProviders mirror the registry byokAuth keys exactly', () => {
  for (const entry of MANAGED_HARNESS_CATALOG) {
    const descriptor = managedHarnessDescriptor(entry.id)
    assert.deepEqual(
      [...entry.byokProviders].sort(),
      Object.keys(descriptor.byokAuth ?? {}).sort(),
      `${entry.id}: the picker's connection filter must match what the server can authenticate`,
    )
  }
})

test('BYOK auth builders produce an env record without persisting secrets', async () => {
  const descriptor = managedHarnessDescriptor('claude-code')
  const build = descriptor.byokAuth?.['user-vercel-ai-gateway']
  assert.ok(build, 'claude-code must accept user Vercel AI Gateway connections')
  const env = build({ apiKey: 'sk-test', endpoint: 'https://ai-gateway.vercel.sh/v1' })
  assert.deepEqual(env, {
    AI_GATEWAY_API_KEY: 'sk-test',
    AI_GATEWAY_BASE_URL: 'https://ai-gateway.vercel.sh',
  })
  const hermes = managedHarnessDescriptor('hermes')
  assert.deepEqual(hermes.byokAuth?.openrouter?.({ apiKey: 'or-key', endpoint: 'https://openrouter.ai/api/v1' }), {
    OPENROUTER_API_KEY: 'or-key',
  })
})
