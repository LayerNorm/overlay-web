import type { WorkspaceBillingUsage } from '@overlay/workspace-contracts'
import { getModel } from '@/shared/ai/gateway/model-data'
import {
  USAGE_RESOURCE_LABELS,
  formatTokens,
  formatUsageQuantity,
  humanizeModelId,
  pluralize,
  type UsageResourceKey,
  type UsageTotal,
} from '@/shared/billing/usage-resources'
import type { BillingSubscriptionRecord } from './BillingRepository'

/** Turns the period's per-resource totals into the lines Workspace → Billing shows (cents, with labels). */
export function workspaceUsageSummary(
  usage: { totals: UsageTotal[]; truncated: boolean },
  plan: BillingSubscriptionRecord,
  periodStart: number,
  /** What the balance says was used this period; the lines are reconciled to it. */
  usedCents?: number,
): WorkspaceBillingUsage {
  const lines: WorkspaceBillingUsage['lines'] = usage.totals
    .filter((total) => total.cents > 0)
    .map((total) => ({
      key: total.resource,
      label: USAGE_RESOURCE_LABELS[total.resource as UsageResourceKey] ?? total.resource,
      quantity: formatUsageQuantity(total),
      cents: roundCents(total.cents),
      ...(total.byModel?.length
        ? {
            details: total.byModel
              .filter((model) => model.cents > 0)
              .map((model) => ({
                label: modelLabel(model.modelId),
                quantity: model.tokens > 0 ? `${formatTokens(model.tokens)} tokens` : pluralize(model.count, 'request', 'requests'),
                cents: roundCents(model.cents),
              })),
          }
        : {}),
    }))
  // Charges recorded before amounts were stored on every usage record cannot be split by resource; show them as one
  // line so the list adds up to what the workspace was actually charged.
  const itemizedCents = lines.reduce((sum, line) => sum + line.cents, 0)
  const earlierCents = roundCents((usedCents ?? 0) - itemizedCents)
  if (earlierCents >= 1) {
    lines.push({ key: 'earlier', label: 'Earlier usage', quantity: 'recorded before itemized billing', cents: earlierCents })
  }
  return {
    periodStart,
    ...(plan.currentPeriodEnd ? { periodEnd: plan.currentPeriodEnd } : {}),
    totalCents: roundCents(lines.reduce((sum, line) => sum + line.cents, 0)),
    onDemandCents: plan.autoTopUpSpentThisPeriodCents ?? 0,
    lines,
    truncated: usage.truncated,
  }
}

function modelLabel(modelId: string): string {
  if (modelId === 'unknown') return 'Other models'
  return getModel(modelId)?.name ?? humanizeModelId(modelId)
}

function roundCents(cents: number): number {
  return Math.round(cents * 100) / 100
}
