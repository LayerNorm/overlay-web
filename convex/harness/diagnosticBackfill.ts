import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { createHarnessDiagnostic, type HarnessDiagnostic } from '../../packages/overlay-agent-runtime/src/harness-diagnostic'
import { appendHarnessDiagnosticIndex } from './diagnostic-index'

const PAGE_SIZE = 100
const PAGE_MAXIMUM_BYTES = 1_000_000

const diagnosticCodes = new Set<HarnessDiagnostic['code']>([
  'TASK_DEADLINE', 'TASK_SPEND_LIMIT', 'WORKSPACE_FUNDS', 'PROVIDER_REJECTED', 'PROVIDER_REQUEST_INVALID',
  'PROVIDER_ACCOUNT', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMIT', 'PROVIDER_UNAVAILABLE', 'TOOL_FAILED',
  'TOOL_OUTCOME_UNKNOWN', 'MODEL_OUTCOME_UNKNOWN', 'AUTHORIZATION_REVOKED', 'PERSISTENCE_FAILED', 'STAGNATION', 'UNKNOWN',
])
const diagnosticStages = new Set<HarnessDiagnostic['stage']>(['admission', 'model', 'tool', 'persistence', 'delivery'])

type StoredMetadata = {
  policy?: { workspaceId?: string }
  diagnostic?: HarnessDiagnostic
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseDiagnostic(value: unknown): HarnessDiagnostic | null {
  if (!isRecord(value) || typeof value.diagnosticId !== 'string' || !value.diagnosticId.trim()
    || value.diagnosticId.length > 256 || typeof value.code !== 'string'
    || !diagnosticCodes.has(value.code as HarnessDiagnostic['code']) || typeof value.stage !== 'string'
    || !diagnosticStages.has(value.stage as HarnessDiagnostic['stage'])
    || (value.operationId !== undefined && (typeof value.operationId !== 'string' || value.operationId.length > 256))
    || !Number.isSafeInteger(value.occurredAt) || (value.occurredAt as number) < 0) return null
  const diagnostic = createHarnessDiagnostic({
    diagnosticId: value.diagnosticId,
    code: value.code as HarnessDiagnostic['code'],
    stage: value.stage as HarnessDiagnostic['stage'],
    ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}),
    occurredAt: value.occurredAt as number,
  })
  return diagnostic.safeMessage === value.safeMessage && diagnostic.nextAction === value.nextAction
    && diagnostic.retryability === value.retryability ? diagnostic : null
}

function parseMetadata(value: string, includeDiagnostic: boolean): { metadata: StoredMetadata | null; malformed: boolean } {
  const parsed = parseJson(value)
  if (!isRecord(parsed)) return { metadata: null, malformed: true }
  const policy = isRecord(parsed.policy) && (parsed.policy.workspaceId === undefined
    || typeof parsed.policy.workspaceId === 'string' && parsed.policy.workspaceId.length <= 256)
    ? { workspaceId: parsed.policy.workspaceId as string | undefined } : undefined
  const metadata: StoredMetadata = { ...(policy ? { policy } : {}) }
  if (includeDiagnostic && parsed.diagnostic !== undefined) {
    const diagnostic = parseDiagnostic(parsed.diagnostic)
    if (!diagnostic) return { metadata, malformed: true }
    metadata.diagnostic = diagnostic
  }
  return { metadata, malformed: false }
}

function parseOperationDiagnostic(value: string): { diagnostic?: HarnessDiagnostic; malformed: boolean } {
  const operation = parseJson(value)
  if (!isRecord(operation)) return { malformed: true }
  if (operation.type !== 'record_diagnostic' && operation.type !== 'block' && operation.type !== 'terminate') {
    return { malformed: false }
  }
  if (operation.diagnostic === undefined && operation.type !== 'record_diagnostic') return { malformed: false }
  const diagnostic = parseDiagnostic(operation.diagnostic)
  return diagnostic ? { diagnostic, malformed: false } : { malformed: true }
}

async function recordDiagnostic(
  ctx: Parameters<typeof appendHarnessDiagnosticIndex>[0],
  run: Doc<'harnessRuns'>,
  metadata: StoredMetadata | null,
  diagnostic: HarnessDiagnostic,
) {
  const status = await appendHarnessDiagnosticIndex(ctx, run, {
    workflowRunId: undefined,
    policy: { workspaceId: metadata?.policy?.workspaceId },
    diagnostic,
  }, diagnostic)
  const failures = diagnostic.operationId
    ? await ctx.db.query('harnessToolFailures')
      .withIndex('by_runId_toolCallId', q => q.eq('runId', run.runId).eq('toolCallId', diagnostic.operationId!))
      .take(1)
    : []
  return { status, causeUnavailable: failures.length === 0 }
}

export const backfill = internalMutation({
  args: {
    source: v.union(v.literal('metadata'), v.literal('journal')),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const table = args.source === 'metadata' ? ctx.db.query('harnessRuns') : ctx.db.query('harnessOperations')
    const page = await table.order('asc').paginate({
      numItems: PAGE_SIZE, cursor: args.cursor, maximumBytesRead: PAGE_MAXIMUM_BYTES,
    })
    const counts = {
      processed: page.page.length,
      diagnosticsFound: 0,
      inserted: 0,
      alreadyPresent: 0,
      collisions: 0,
      causeUnavailable: 0,
      malformed: 0,
      missingRuns: 0,
    }

    for (const row of page.page) {
      let run: Doc<'harnessRuns'> | null = null
      let metadata: StoredMetadata | null = null
      let diagnostic: HarnessDiagnostic | undefined
      if (args.source === 'metadata') {
        run = row as Doc<'harnessRuns'>
        const parsedMetadata = parseMetadata(run.metadataJson, true)
        metadata = parsedMetadata.metadata
        diagnostic = metadata?.diagnostic
        if (parsedMetadata.malformed) counts.malformed++
      } else {
        const operationRow = row as Doc<'harnessOperations'>
        const parsedOperation = parseOperationDiagnostic(operationRow.operationJson)
        if (parsedOperation.malformed) counts.malformed++
        diagnostic = parsedOperation.diagnostic
        if (!diagnostic) continue
        run = await ctx.db.query('harnessRuns')
          .withIndex('by_runId', q => q.eq('runId', operationRow.runId)).unique()
        if (!run) {
          counts.missingRuns++
          continue
        }
        const parsedMetadata = parseMetadata(run.metadataJson, false)
        metadata = parsedMetadata.metadata
        if (parsedMetadata.malformed) counts.malformed++
      }
      if (!diagnostic || !run) continue
      counts.diagnosticsFound++
      const result = await recordDiagnostic(ctx, run, metadata, diagnostic)
      if (result.status === 'inserted') counts.inserted++
      else if (result.status === 'existing') counts.alreadyPresent++
      else counts.collisions++
      if (result.causeUnavailable) counts.causeUnavailable++
    }

    return {
      source: args.source,
      ...counts,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})
