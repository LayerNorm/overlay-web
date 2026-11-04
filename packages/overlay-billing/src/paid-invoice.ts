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

function isRecurringInvoice(invoice: PaidInvoice, expected: { customerId: string; subscriptionId: string }): boolean {
  return invoice.status === 'paid'
    && invoice.currency === 'usd'
    && ['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason ?? '')
    && stripeReferenceId(invoice.customer) === expected.customerId
    && stripeReferenceId(invoice.parent?.subscription_details?.subscription) === expected.subscriptionId
}

function invoiceLine(invoice: PaidInvoice) {
  return invoice.lines?.has_more || invoice.lines?.data?.length !== 1
    ? null
    : invoice.lines.data[0] ?? null
}

function invoiceAmount(line: NonNullable<ReturnType<typeof invoiceLine>>, expected: { priceId: string; unitAmountCents?: number }, amountPaid: number | undefined) {
  const quantity = line.quantity ?? 0
  const unitAmountCents = expected.unitAmountCents ?? 100
  const amountCents = quantity * unitAmountCents
  if (!expected.priceId || stripeReferenceId(line.pricing?.price_details?.price) !== expected.priceId
    || line.parent?.subscription_item_details?.proration !== false
    || !Number.isSafeInteger(unitAmountCents) || unitAmountCents <= 0
    || !Number.isSafeInteger(quantity) || !Number.isSafeInteger(amountCents) || amountCents < 800 || amountCents > 50_000
    || !Number.isFinite(amountPaid) || amountPaid! < amountCents) return null
  return { quantity, unitAmountCents, amountCents }
}

function invoicePeriod(line: NonNullable<ReturnType<typeof invoiceLine>>) {
  const period = line.period
  if (!period || !Number.isSafeInteger(period.start) || !Number.isSafeInteger(period.end)
    || period.start <= 0 || period.end <= period.start) return null
  return period
}

/** Only a fully paid recurring invoice funds a period; lifecycle events are not payment evidence. */
export function paidInvoiceFunding(invoice: PaidInvoice, expected: {
  customerId: string
  subscriptionId: string
  priceId: string
  unitAmountCents?: number
}): { paidInvoiceId: string; paidPeriodStart: number; paidPeriodEnd: number; amountCents: number; quantity: number } | null {
  if (!isRecurringInvoice(invoice, expected)) return null
  const line = invoiceLine(invoice)
  if (!line) return null
  const amount = invoiceAmount(line, expected, invoice.amount_paid)
  const period = invoicePeriod(line)
  if (!amount || !period) return null
  return {
    paidInvoiceId: invoice.id,
    paidPeriodStart: period.start * 1000,
    paidPeriodEnd: period.end * 1000,
    amountCents: amount.amountCents,
    quantity: amount.quantity,
  }
}
