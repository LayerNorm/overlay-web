type StripeReference = string | { id?: string } | null

export type PaidInvoice = {
  id: string
  status?: string | null
  currency?: string
  amount_paid?: number
  billing_reason?: string | null
  customer?: StripeReference
  parent?: { subscription_details?: { subscription?: StripeReference } | null } | null
  lines?: {
    has_more?: boolean
    data?: Array<{
      quantity?: number | null
      period?: { start: number; end: number }
      pricing?: { price_details?: { price?: StripeReference } | null } | null
      parent?: { subscription_item_details?: { proration?: boolean } | null } | null
    }>
  }
}

export function stripeReferenceId(value: StripeReference | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.id
}

/** Only a fully paid recurring invoice funds a period; lifecycle events are not payment evidence. */
export function paidInvoiceFunding(invoice: PaidInvoice, expected: {
  customerId: string
  subscriptionId: string
  priceId: string
  unitAmountCents?: number
}): { paidInvoiceId: string; paidPeriodStart: number; paidPeriodEnd: number; amountCents: number; quantity: number } | null {
  if (invoice.status !== 'paid' || invoice.currency !== 'usd'
    || !['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason ?? '')
    || stripeReferenceId(invoice.customer) !== expected.customerId
    || stripeReferenceId(invoice.parent?.subscription_details?.subscription) !== expected.subscriptionId
    || invoice.lines?.has_more || invoice.lines?.data?.length !== 1) return null
  const line = invoice.lines.data[0]!
  const quantity = line.quantity ?? 0
  const unitAmountCents = expected.unitAmountCents ?? 100
  const amountCents = quantity * unitAmountCents
  if (!expected.priceId || stripeReferenceId(line.pricing?.price_details?.price) !== expected.priceId
    || line.parent?.subscription_item_details?.proration !== false
    || !Number.isSafeInteger(unitAmountCents) || unitAmountCents <= 0
    || !Number.isSafeInteger(quantity) || !Number.isSafeInteger(amountCents) || amountCents < 800 || amountCents > 50_000
    || !Number.isFinite(invoice.amount_paid) || invoice.amount_paid! < amountCents
    || !line.period || !Number.isSafeInteger(line.period.start) || !Number.isSafeInteger(line.period.end)
    || line.period.start <= 0 || line.period.end <= line.period.start) return null
  return { paidInvoiceId: invoice.id, paidPeriodStart: line.period.start * 1000, paidPeriodEnd: line.period.end * 1000, amountCents, quantity }
}
