import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'

const MAX_CHECKPOINT_BYTES = 7_500
const MAX_EVIDENCE = 24

export type HarnessCheckpoint = {
  version: 1
  goal: string
  progressRevision: number
  planRevision: number
  plan: Array<{ id: string; status: string; evidenceRefs: string[] }>
  evidence: Array<{
    id: string
    source: string
    verdict: string
    summary: string
    resource?: { id: string; revision?: string; operation?: string; page?: number }
  }>
  omittedEvidenceCount: number
  evidenceLookup: 'harness_read_evidence'
}

function checkpointFor(state: HarnessSnapshot, evidence: HarnessSnapshot['evidence']): HarnessCheckpoint {
  return {
    version: 1,
    goal: state.goal,
    progressRevision: state.progressRevision,
    planRevision: state.planRevision,
    plan: state.plan.map(step => ({ id: step.id, status: step.status, evidenceRefs: [...step.evidenceRefs] })),
    evidence: evidence.map(item => ({
      id: item.id,
      source: item.source,
      verdict: item.verdict,
      summary: item.summary.replace(/(?:data:[^;\s]+;base64,)[A-Za-z0-9+/=]+/gi, '[binary payload omitted]').slice(0, 320),
      ...(item.resource ? { resource: { ...item.resource } } : {}),
    })),
    omittedEvidenceCount: Math.max(0, state.evidence.length - evidence.length),
    evidenceLookup: 'harness_read_evidence',
  }
}

export function buildHarnessCheckpoint(state: HarnessSnapshot): HarnessCheckpoint {
  const ordered = [...state.evidence].sort((left, right) => left.createdAt - right.createdAt)
  let count = Math.min(MAX_EVIDENCE, ordered.length)
  while (count >= 0) {
    const result = checkpointFor(state, count ? ordered.slice(-count) : [])
    if (JSON.stringify(result).length <= MAX_CHECKPOINT_BYTES) return result
    count--
  }
  return checkpointFor(state, [])
}

export function serializeHarnessCheckpoint(state: HarnessSnapshot): string {
  return JSON.stringify(buildHarnessCheckpoint(state))
}

export function buildHarnessEvidenceEnvelope(state: HarnessSnapshot, candidate: string): string {
  return JSON.stringify({
    goal: state.goal,
    plan: state.plan.map(step => ({
      id: step.id, title: step.title, status: step.status, evidenceRefs: step.evidenceRefs,
    })),
    observations: state.evidence.slice(-48).map(evidence => ({
      id: evidence.id,
      source: evidence.source,
      verdict: evidence.verdict,
      summary: evidence.summary.slice(0, 2_000),
      ...(evidence.resource ? { resource: evidence.resource } : {}),
    })),
    candidateAnswer: candidate.slice(0, 16_000),
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
  const input = new TextEncoder().encode(candidate)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
