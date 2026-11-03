import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

/** Record an absorbed provider expense without replaying a released wallet hold. */
export const recordInternal = internalMutation({
  args: {
    expectedDeploymentUrl: v.string(),
    billingAccountId: v.string(),
    reservationId: v.string(),
    modelId: v.string(),
    providerCostMicros: v.number(),
    usageTokens: v.number(),
    evidence: v.object({ source: v.string(), reference: v.string(), reason: v.string() }),
  },
  returns: v.object({ idempotent: v.boolean(), providerCostMicros: v.number() }),
  handler: async (ctx, args) => {
    if (args.expectedDeploymentUrl !== process.env.CONVEX_CLOUD_URL) throw new Error('deployment_mismatch')
    if (!Number.isSafeInteger(args.providerCostMicros) || args.providerCostMicros < 0
      || !Number.isSafeInteger(args.usageTokens) || args.usageTokens < 0) throw new Error('invalid_provider_usage')
    const evidence = {
      source: args.evidence.source.trim(), reference: args.evidence.reference.trim(), reason: args.evidence.reason.trim(),
    }
    if (Object.values(evidence).some(value => !value || value.length > 2_000)) throw new Error('provider_evidence_required')
    const row = await ctx.db.query('budgetReservations')
      .withIndex('by_reservationId', q => q.eq('reservationId', args.reservationId)).unique()
    if (!row || row.billingAccountId !== args.billingAccountId || row.modelId !== args.modelId) {
      throw new Error('reservation_evidence_mismatch')
    }
    if (row.status !== 'released' || row.providerWorkStarted !== true) throw new Error('reservation_not_released_provider_work')
    if (row.providerCostMicros !== undefined || row.providerCostEvidence !== undefined) {
      if (row.providerCostMicros !== args.providerCostMicros || row.usageTokens !== args.usageTokens
        || row.providerCostEvidence?.source !== evidence.source
        || row.providerCostEvidence?.reference !== evidence.reference
        || row.providerCostEvidence?.reason !== evidence.reason) throw new Error('provider_evidence_conflict')
      return { idempotent: true, providerCostMicros: args.providerCostMicros }
    }
    // Preserve release status, reconciliation audit, timestamps and all wallet/subject counters.
    await ctx.db.patch(row._id, {
      providerCostMicros: args.providerCostMicros,
      usageTokens: args.usageTokens,
      providerCostEvidence: { ...evidence, recordedAt: Date.now() },
    })
    return { idempotent: false, providerCostMicros: args.providerCostMicros }
  },
})
