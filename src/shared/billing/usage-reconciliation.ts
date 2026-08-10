export type UsageReconciliationResolution = 'finalize' | 'release'

export type UsageReconciliationEvidence = {
  reason: string
  reference: string
  source: string
}

export type NormalizedUsageReconciliationResolution = {
  actualCostCents?: number
  evidence: UsageReconciliationEvidence
  resolution: UsageReconciliationResolution
}

const MAX_EVIDENCE_SOURCE_LENGTH = 100
const MAX_EVIDENCE_REFERENCE_LENGTH = 500
const MAX_REASON_LENGTH = 2_000

export function normalizeUsageReconciliationResolution(args: {
  actualCostCents?: number
  evidence: UsageReconciliationEvidence
  reservedCents: number
  resolution: UsageReconciliationResolution
}): NormalizedUsageReconciliationResolution {
  const source = requiredBoundedText(
    args.evidence.source,
    'reconciliation_evidence_source_required',
    MAX_EVIDENCE_SOURCE_LENGTH,
  )
  const reference = requiredBoundedText(
    args.evidence.reference,
    'reconciliation_evidence_reference_required',
    MAX_EVIDENCE_REFERENCE_LENGTH,
  )
  const reason = requiredBoundedText(
    args.evidence.reason,
    'reconciliation_reason_required',
    MAX_REASON_LENGTH,
  )
  if (!Number.isFinite(args.reservedCents) || args.reservedCents < 0) {
    throw new Error('invalid_reserved_cost')
  }

  if (args.resolution === 'release') {
    if (args.actualCostCents !== undefined) {
      throw new Error('release_resolution_cannot_include_actual_cost')
    }
    return {
      evidence: { reason, reference, source },
      resolution: 'release',
    }
  }

  if (
    args.actualCostCents === undefined ||
    !Number.isFinite(args.actualCostCents) ||
    args.actualCostCents < 0
  ) {
    throw new Error('finalize_resolution_requires_actual_cost')
  }
  if (args.actualCostCents > args.reservedCents + 0.000001) {
    throw new Error('actual_cost_exceeds_reservation')
  }
  return {
    actualCostCents: args.actualCostCents,
    evidence: { reason, reference, source },
    resolution: 'finalize',
  }
}

function requiredBoundedText(value: string, errorCode: string, maxLength: number): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(errorCode)
  return normalized.slice(0, maxLength)
}
