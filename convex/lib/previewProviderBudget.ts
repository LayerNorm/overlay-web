import type { MutationCtx } from '../_generated/server'
import { isPreviewDeployment } from './preview'

function budgetMicros() {
  const cents = Number(process.env.OVERLAY_PREVIEW_PROVIDER_BUDGET_CENTS ?? '500')
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 2_500) throw new Error('Invalid Preview provider budget')
  return cents * 10_000
}

async function snapshot(ctx: MutationCtx) {
  // Preview-only bounded accounting; unexpected size fails admission closed.
  const balances = await ctx.db.query('billingAccountBalances')
    .withIndex('by_mode_updatedAt').take(1_001)
  if (balances.length > 1_000) throw new Error('Preview budget inventory exceeds its supported size')
  let row = await ctx.db.query('previewProviderBudget').withIndex('by_key', q => q.eq('key', 'provider-budget')).unique()
  if (!row) {
    const id = await ctx.db.insert('previewProviderBudget', { key: 'provider-budget',
      spentMicros: balances.reduce((total, balance) => total + balance.usedMicros, 0), updatedAt: Date.now() })
    row = await ctx.db.get(id)
  }
  if (!row) throw new Error('Preview provider budget initialization failed')
  return { row, reservedMicros: balances.reduce((total, balance) => total + balance.reservedMicros, 0) }
}

/** Retail holds conservatively cover provider cost, across every Preview wallet. */
export async function previewProviderBudgetAvailable(ctx: MutationCtx, additionalMicros: number): Promise<boolean> {
  if (!isPreviewDeployment()) return true
  if (!Number.isFinite(additionalMicros) || additionalMicros < 0) throw new Error('Invalid Preview commitment')
  const { row, reservedMicros } = await snapshot(ctx)
  return row.spentMicros + reservedMicros + additionalMicros <= budgetMicros()
}

/** Settlement is always recorded, including stop/final usage after a limit hit. */
export async function recordPreviewProviderSpend(ctx: MutationCtx, actualMicros: number): Promise<void> {
  if (!isPreviewDeployment() || actualMicros <= 0) return
  const { row } = await snapshot(ctx)
  await ctx.db.patch(row._id, { spentMicros: row.spentMicros + actualMicros, updatedAt: Date.now() })
}
