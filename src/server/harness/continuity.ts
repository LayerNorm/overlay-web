import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'

const MAX_CHECKPOINT_BYTES = 7_500
const MAX_EVIDENCE = 6
const MAX_PLAN = 4

export type HarnessCheckpoint = {
  version: 1
  goal: string
  goalOmittedCharacters: number
  progressRevision: number
  planRevision: number
  plan: Array<{ id: string; status: string; evidenceRefs: string[]; omittedEvidenceRefCount: number }>
  omittedPlanCount: number
  evidence: Array<{
    id: string
    source: string
    verdict: string
    summary: string
    excerptTruncated: boolean
    resource?: { id: string; revision?: string; operation?: string; page?: number }
    resourceTruncated?: boolean
  }>
  omittedEvidenceCount: number
  evidenceLookup: 'harness_read_evidence'
}

function checkpointFor(state: HarnessSnapshot, evidence: HarnessSnapshot['evidence'], planCount = MAX_PLAN, goalLimit = 900, summaryLimit = 240): HarnessCheckpoint {
  const goal = state.goal.slice(0, goalLimit)
  const plan = planCount ? state.plan.slice(-planCount) : []
  return {
    version: 1,
    goal: goal.length < state.goal.length ? `${goal} [TRUNCATED]` : goal,
    goalOmittedCharacters: Math.max(0, state.goal.length - goal.length),
    progressRevision: state.progressRevision,
    planRevision: state.planRevision,
    plan: plan.map(step => ({
      id: step.id,
      status: step.status,
      evidenceRefs: step.evidenceRefs.slice(0, 2),
      omittedEvidenceRefCount: Math.max(0, step.evidenceRefs.length - 2),
    })),
    omittedPlanCount: Math.max(0, state.plan.length - plan.length),
    evidence: evidence.map(item => ({
      id: item.id,
      source: item.source.slice(0, 128),
      verdict: item.verdict,
      summary: item.summary.replace(/(?:data:[^;\s]+;base64,)[A-Za-z0-9+/=]+/gi, '[binary payload omitted]').slice(0, summaryLimit)
        + (item.summary.length > summaryLimit ? ' [TRUNCATED]' : ''),
      excerptTruncated: item.summary.length > summaryLimit,
      ...(item.resource ? {
        resource: {
          id: item.resource.id.slice(0, 128),
          ...(item.resource.revision ? { revision: item.resource.revision.slice(0, 128) } : {}),
          ...(item.resource.operation ? { operation: item.resource.operation.slice(0, 128) } : {}),
          ...(item.resource.page !== undefined ? { page: item.resource.page } : {}),
        },
        ...(item.resource.id.length > 128 || (item.resource.revision?.length ?? 0) > 128
          || (item.resource.operation?.length ?? 0) > 128 ? { resourceTruncated: true } : {}),
      } : {}),
    })),
    omittedEvidenceCount: Math.max(0, state.evidence.length - evidence.length),
    evidenceLookup: 'harness_read_evidence',
  }
}

export function buildHarnessCheckpoint(state: HarnessSnapshot): HarnessCheckpoint {
  const ordered = [...state.evidence].sort((left, right) => left.createdAt - right.createdAt)
  let count = Math.min(MAX_EVIDENCE, ordered.length)
  for (const summaryLimit of [2_000, 1_000, 500]) {
    const result = checkpointFor(state, count ? ordered.slice(-count) : [], MAX_PLAN, 900, summaryLimit)
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_CHECKPOINT_BYTES) return result
  }
  while (count >= 0) {
    const result = checkpointFor(state, count ? ordered.slice(-count) : [])
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_CHECKPOINT_BYTES) return result
    count--
  }
  for (let planCount = MAX_PLAN - 1; planCount >= 0; planCount--) {
    const result = checkpointFor(state, [], planCount)
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_CHECKPOINT_BYTES) return result
  }
  return checkpointFor(state, [], 0, 0)
}

export function serializeHarnessCheckpoint(state: HarnessSnapshot): string {
  return JSON.stringify(buildHarnessCheckpoint(state))
}

export function buildHarnessEvidenceEnvelope(state: HarnessSnapshot, candidate: string): string {
  if (candidate.length > 16_000) {
    throw new Error('The proposed answer exceeds the verification limit. Produce a shorter answer that can be checked in full.')
  }
  const observations = state.evidence.slice(-48)
  return JSON.stringify({
    goal: state.goal,
    plan: state.plan.map(step => ({
      id: step.id, title: step.title, status: step.status, evidenceRefs: step.evidenceRefs,
    })),
    observationsOmittedCount: Math.max(0, state.evidence.length - observations.length),
    observationsLookup: 'harness_read_evidence',
    observations: observations.map(evidence => ({
      id: evidence.id,
      source: evidence.source,
      verdict: evidence.verdict,
      summary: evidence.summary.length > 2_000
        ? `${evidence.summary.slice(0, 1_980)} [INCOMPLETE]` : evidence.summary,
      ...(evidence.resource ? { resource: evidence.resource } : {}),
    })),
    candidateAnswer: candidate,
  })
}

export function parseHarnessVerificationResponse(raw: string, evidenceIds: ReadonlySet<string>): {
  supported: boolean
  reason: string
  evidenceIds: string[]
} {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid verification JSON.')
  const record = parsed as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'evidenceIds,reason,supported'
    || typeof record.supported !== 'boolean'
    || typeof record.reason !== 'string' || record.reason.length > 1_000
    || !Array.isArray(record.evidenceIds) || record.evidenceIds.length > 48
    || record.evidenceIds.some(id => typeof id !== 'string' || !evidenceIds.has(id))
    || new Set(record.evidenceIds).size !== record.evidenceIds.length) {
    throw new Error('Final answer verification returned an invalid evidence reference.')
  }
  return {
    supported: record.supported,
    reason: record.reason,
    evidenceIds: record.evidenceIds as string[],
  }
}

export async function harnessCandidateDigest(candidate: string): Promise<string> {
  'use step'
  if (!globalThis.crypto?.subtle) throw new Error('Harness verification hashing is unavailable in this runtime.')
  const input = new TextEncoder().encode(candidate)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
