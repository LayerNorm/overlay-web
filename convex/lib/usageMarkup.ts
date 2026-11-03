import {
  applyMarkupToDollars as calculateMarkupToDollars,
  parseUsageMarkupBasisPoints,
} from '../../src/shared/billing/billing-pricing'

export function configuredUsageMarkupBasisPoints(): number {
  return parseUsageMarkupBasisPoints(process.env.OVERLAY_USAGE_MARKUP_BPS)
}

export function applyMarkupToDollars(params: { providerCostUsd: number }): number {
  return calculateMarkupToDollars({ ...params, markupBasisPoints: configuredUsageMarkupBasisPoints() })
}
