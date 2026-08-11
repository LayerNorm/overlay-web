import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assertBillableFeatureCoverage,
  BILLABLE_FEATURE_CATEGORIES,
  BILLABLE_FEATURE_COVERAGE,
} from './billable-feature-coverage'

test('every launch category is metered or has a positive bounded quota', () => {
  assert.doesNotThrow(() => assertBillableFeatureCoverage())
  assert.deepEqual(
    [...new Set(BILLABLE_FEATURE_COVERAGE.map((entry) => entry.category))].sort(),
    [...BILLABLE_FEATURE_CATEGORIES].sort(),
  )
})

test('every coverage claim points to a real enforcement marker', () => {
  for (const entry of BILLABLE_FEATURE_COVERAGE) {
    for (const reference of entry.enforcement) {
      const [file, marker] = reference.split('#')
      const source = readFileSync(file!, 'utf8')
      if (marker) assert.ok(source.includes(marker), `${entry.id} is missing ${marker} in ${file}`)
    }
  }
})

test('workspace-funded provider boundaries resolve resource and subject payer context', () => {
  const files = [
    'src/server/app-api/v1/conversations/act/route.ts',
    'src/server/agents/workspace-agent-invocation.ts',
    'src/server/knowledge/PostgresKnowledgeSearchRepository.ts',
    'src/server/knowledge/KnowledgeIndexService.ts',
    'src/server/memory/MemoryExtractionService.ts',
    'src/server/app-api/v1/browser-task/route.ts',
    'src/server/app-api/v1/daytona/run/lifecycle.ts',
    'src/server/app-api/v1/generate-image/route.ts',
    'src/server/app-api/v1/generate-video/route.ts',
    'src/server/app-api/v1/transcribe/route.ts',
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /workspaceId/, `${file} does not pass resource workspace billing context`)
  }
  assert.match(
    readFileSync('convex/knowledge/knowledge.ts', 'utf8'),
    /reserveWorkspaceBudgetByServer/,
  )
})
