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
): WorkspaceBillingUsage {
  const lines = usage.totals
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
