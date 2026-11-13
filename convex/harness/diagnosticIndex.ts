import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { HarnessDiagnostic } from '../../packages/overlay-agent-runtime/src/harness-diagnostic'
import type { HarnessSource, HarnessToolFailure } from '../../packages/overlay-agent-runtime/src/harness-store'

type RunCorrelation = Pick<Doc<'harnessRuns'>, 'runId' | 'actorUserId' | 'sourceJson'>
type SnapshotCorrelation = {
  workflowRunId?: string
  policy: { workspaceId?: string }
  diagnostic?: HarnessDiagnostic
}
type SourceCorrelation = {
  sourceType: 'conversation' | 'note' | 'unknown'
  sourceId?: string
}

function sourceCorrelation(sourceJson: string): SourceCorrelation {
  try {
    const source = JSON.parse(sourceJson) as Partial<HarnessSource>
    if (typeof source.conversationId === 'string') return { sourceType: 'conversation', sourceId: source.conversationId }
    if (typeof source.noteId === 'string') return { sourceType: 'note', sourceId: source.noteId }
  } catch {
    return { sourceType: 'unknown' }
  }
  return { sourceType: 'unknown' }
}

function sameDiagnostic(
  row: Doc<'harnessDiagnosticIndex'>,
  diagnostic: HarnessDiagnostic,
  run: RunCorrelation,
) {
  return row.diagnosticId === diagnostic.diagnosticId
    && row.runId === run.runId
    && row.operationId === diagnostic.operationId
    && row.code === diagnostic.code
    && row.stage === diagnostic.stage
    && row.retryability === diagnostic.retryability
    && row.safeMessage === diagnostic.safeMessage
    && row.nextAction === diagnostic.nextAction
    && row.occurredAt === diagnostic.occurredAt
}

export async function appendHarnessDiagnosticIndex(
  ctx: MutationCtx,
  run: RunCorrelation,
  snapshot: SnapshotCorrelation,
  diagnostic: HarnessDiagnostic = snapshot.diagnostic!,
): Promise<'inserted' | 'existing' | 'collision'> {
  if (!diagnostic) throw new Error('Harness diagnostic index requires a diagnostic.')
  const existing = await ctx.db.query('harnessDiagnosticIndex')
    .withIndex('by_runId_diagnosticId', q => q.eq('runId', run.runId).eq('diagnosticId', diagnostic.diagnosticId))
    .take(2)
  if (existing.some(row => sameDiagnostic(row, diagnostic, run))) return 'existing'
  const source = sourceCorrelation(run.sourceJson)
  await ctx.db.insert('harnessDiagnosticIndex', {
    diagnosticId: diagnostic.diagnosticId,
    runId: run.runId,
    workflowRunId: snapshot.workflowRunId,
    actorUserId: run.actorUserId,
    workspaceId: snapshot.policy.workspaceId,
    ...source,
    operationId: diagnostic.operationId,
    code: diagnostic.code,
    stage: diagnostic.stage,
    retryability: diagnostic.retryability,
    safeMessage: diagnostic.safeMessage,
    nextAction: diagnostic.nextAction,
    occurredAt: diagnostic.occurredAt,
    indexedAt: Date.now(),
  })
  return existing.length > 0 ? 'collision' : 'inserted'
}

function sameFailure(row: Doc<'harnessToolFailures'>, failure: HarnessToolFailure, workflowRunId: string | undefined) {
  return row.toolCallId === failure.toolCallId
    && row.workflowRunId === workflowRunId
    && row.toolName === failure.toolName
    && row.phase === failure.phase
    && row.causeClass === failure.causeClass
    && row.causeCode === failure.causeCode
    && row.safeSummary === failure.safeSummary
    && JSON.stringify(row.validationIssues ?? []) === JSON.stringify(failure.validationIssues ?? [])
}

export async function persistHarnessToolFailure(
  ctx: MutationCtx,
  run: RunCorrelation,
  snapshot: SnapshotCorrelation,
  failure: HarnessToolFailure,
  createdAt: number,
): Promise<'inserted' | 'existing'> {
  const existing = await ctx.db.query('harnessToolFailures')
    .withIndex('by_runId_toolCallId', q => q.eq('runId', run.runId).eq('toolCallId', failure.toolCallId))
    .take(2)
  if (existing.length > 1) throw new Error('HARNESS_TOOL_FAILURE_ID_CONFLICT')
  if (existing[0]) {
    if (!sameFailure(existing[0], failure, snapshot.workflowRunId)) throw new Error('HARNESS_TOOL_FAILURE_ID_CONFLICT')
    return 'existing'
  }
  const source = sourceCorrelation(run.sourceJson)
  await ctx.db.insert('harnessToolFailures', {
    runId: run.runId,
    toolCallId: failure.toolCallId,
    workflowRunId: snapshot.workflowRunId,
    actorUserId: run.actorUserId,
    workspaceId: snapshot.policy.workspaceId,
    ...source,
    toolName: failure.toolName,
    phase: failure.phase,
    causeClass: failure.causeClass,
    causeCode: failure.causeCode,
    safeSummary: failure.safeSummary,
    validationIssues: failure.validationIssues,
    createdAt,
  })
  return 'inserted'
}
