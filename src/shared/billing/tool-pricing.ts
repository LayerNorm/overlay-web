export const COMPOSIO_TOOL_CALL_PRICE_USD = 0.0003

export type ToolCallCostBucket =
  | 'perplexity'
  | 'image'
  | 'video'
  | 'browser'
  | 'daytona'
  | 'composio'
  | 'internal'

/**
 * Flat per-call price for tool invocations that are billed independently of a
 * usage reservation. Buckets billed through their own routes (browser tasks,
 * sandboxes, media generation) return undefined here so they are not
 * double-charged.
 */
export function toolCallBillableCostUsd(bucket: ToolCallCostBucket): number | undefined {
  if (bucket === 'composio') return COMPOSIO_TOOL_CALL_PRICE_USD
  return undefined
}
