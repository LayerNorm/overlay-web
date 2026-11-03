import 'server-only'
import { FatalError } from 'workflow'
import { createReleaseFlags } from '@/server/releases/feature-flags'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'
import { fileAnalysisAssignments, fileAnalysisCoverage } from './file-analysis-coverage'

export async function resolveFileAnalysisEnabled(reference: HarnessExecutionReference) {
  'use step'
  const state = await new ConvexHarnessRepository().get(reference)
  if (!state || state.workflowRunId !== reference.workflowRunId) throw new FatalError('Invalid analysis authority.')
  const workspaceId = state.policy.workspaceId
  if (!workspaceId || !['read_file', 'read_document', 'computer_exec'].every(id => state.policy.allowedToolIds.includes(id))) return false
  return createReleaseFlags({ userId: reference.actorUserId, workspaceId }, ['harness-file-analysis'])
    .isEnabled('harness-file-analysis')
}

export async function readFileAnalysisCoverage(reference: HarnessExecutionReference, childRunId: string) {
  'use step'
  const repository = new ConvexHarnessRepository()
  const parent = await repository.get(reference)
  if (!parent || parent.workflowRunId !== reference.workflowRunId
    || !parent.children.some(child => child.id === childRunId)) throw new FatalError('Invalid analysis lineage.')
  const child = await repository.get({ actorUserId: reference.actorUserId, runId: childRunId })
  if (!child || child.parentRunId !== parent.runId || child.rootRunId !== parent.rootRunId) throw new FatalError('Invalid analysis child.')
  const assignments = fileAnalysisAssignments(child)
  if (!assignments) return null
  const observations = await repository.readDocumentEvidence({ actorUserId: reference.actorUserId, runId: child.runId })
  const evidence = [...observations.evidence]
  const queue = [child]
  const seen = new Set([child.runId])
  let limited = observations.limited
  while (queue.length) {
    const current = queue.shift()!
    for (const entry of current.children) {
      if (seen.has(entry.id)) continue
      if (seen.size >= 128) { limited = true; break }
      const descendant = await repository.get({ actorUserId: reference.actorUserId, runId: entry.id })
      if (!descendant || descendant.parentRunId !== current.runId || descendant.rootRunId !== parent.rootRunId
        || descendant.policy.workspaceId !== parent.policy.workspaceId
        || descendant.depth > parent.policy.maxDepth) throw new FatalError('Invalid analysis descendant.')
      seen.add(entry.id)
      const observations = await repository.readDocumentEvidence({ actorUserId: reference.actorUserId, runId: descendant.runId })
      evidence.push(...observations.evidence)
      limited ||= observations.limited
      queue.push(descendant)
    }
  }
  const coverage = fileAnalysisCoverage(assignments, evidence)
  return { ...coverage, complete: coverage.complete && child.status === 'completed' && !limited, traversalLimited: limited }
}
