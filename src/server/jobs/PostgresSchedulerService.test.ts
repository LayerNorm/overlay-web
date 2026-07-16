import assert from 'node:assert/strict'
import test from 'node:test'
import type { OverlayRuntimeConfig } from '@/shared/config'
import {
  isPostgresKnowledgeRuntimeEnabled,
  postgresRuntimeSchedulesForConfig,
} from './PostgresSchedulerService'

function runtimeConfig(overrides: {
  automations?: boolean
  embeddings?: 'ai-gateway' | 'openai' | 'azure-openai' | 'none'
  files?: boolean
  knowledge?: boolean
  objectStorage?: 'r2' | 's3' | 'none'
  sandbox?: 'daytona' | 'e2b' | 'local-firecracker' | 'none'
  sandboxes?: boolean
  vectorSearch?: boolean
  vectorSearchProvider?: 'convex' | 'pgvector' | 'pinecone' | 'none'
} = {}): OverlayRuntimeConfig {
  return {
    features: {
      automations: overrides.automations ?? false,
      files: overrides.files ?? false,
      knowledge: overrides.knowledge ?? false,
      sandboxes: overrides.sandboxes ?? false,
      vectorSearch: overrides.vectorSearch ?? false,
    },
    providers: {
      embeddings: { provider: overrides.embeddings ?? 'none' },
      objectStorage: { provider: overrides.objectStorage ?? 'none' },
      sandbox: { provider: overrides.sandbox ?? 'none' },
      vectorSearch: { provider: overrides.vectorSearchProvider ?? 'none' },
    },
  } as OverlayRuntimeConfig
}

test('minimal Postgres profiles do not register disabled background schedules', () => {
  const schedules = postgresRuntimeSchedulesForConfig(runtimeConfig())
  const ids = new Set(schedules.map((schedule) => schedule.id))

  assert.equal(ids.has('storage-reconciliation'), false)
  assert.equal(ids.has('knowledge-maintenance'), false)
  assert.equal(ids.has('automation-schedule-due'), false)
  assert.equal(ids.has('daytona-reconciliation'), false)
  assert.equal(ids.has('app-data-maintenance'), true)
  assert.equal(ids.has('coordination-cleanup'), true)
})

test('feature-complete Postgres profiles register capability-backed schedules', () => {
  const config = runtimeConfig({
    automations: true,
    embeddings: 'openai',
    files: true,
    knowledge: true,
    objectStorage: 's3',
    sandbox: 'daytona',
    sandboxes: true,
    vectorSearch: true,
    vectorSearchProvider: 'pgvector',
  })
  const ids = new Set(postgresRuntimeSchedulesForConfig(config).map((schedule) => schedule.id))

  assert.equal(ids.has('storage-reconciliation'), true)
  assert.equal(ids.has('knowledge-maintenance'), true)
  assert.equal(ids.has('automation-schedule-due'), true)
  assert.equal(ids.has('daytona-reconciliation'), true)
  assert.equal(isPostgresKnowledgeRuntimeEnabled(config), true)
})

test('knowledge maintenance requires both pgvector and an embeddings provider', () => {
  assert.equal(isPostgresKnowledgeRuntimeEnabled(runtimeConfig({
    embeddings: 'none',
    knowledge: true,
    vectorSearch: true,
    vectorSearchProvider: 'pgvector',
  })), false)
  assert.equal(isPostgresKnowledgeRuntimeEnabled(runtimeConfig({
    embeddings: 'openai',
    knowledge: true,
    vectorSearch: true,
    vectorSearchProvider: 'none',
  })), false)
})
