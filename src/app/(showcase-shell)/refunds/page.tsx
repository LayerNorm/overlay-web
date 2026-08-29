import { LegalPageTemplate } from '@/features/marketing/components/LegalPageTemplate'
import { LEGAL_EFFECTIVE_DATE } from '@/shared/legal/legal-documents'

const sections = [
  { title: 'Recurring subscriptions', body: 'Paid plans renew automatically at the amount and interval shown at checkout until canceled. Cancel through the billing portal before renewal to avoid the next recurring charge. Cancellation takes effect at the end of the paid period unless law or the checkout disclosure says otherwise.' },
  { title: 'Usage and top-ups', body: 'Usage-based charges and purchased credits reflect model, tool, sandbox, storage, or other measured consumption under the displayed pricing rules. One-time and automatic top-ups are charged when triggered. Usage records may be reconciled after provider reporting; LayerNorm will not knowingly charge more than the disclosed pricing rule.' },
  { title: 'Refunds', body: 'Except where law requires, fees for a started subscription period, consumed usage, and completed top-ups are non-refundable. LayerNorm may issue credits or refunds for duplicate charges, confirmed metering errors, or material service failures at its discretion. Promotional credits have no cash value.' },
  { title: 'Disputes and taxes', body: 'Send a billing dispute to divyansh@layernorm.co promptly with the account, invoice, amount, date, and reason. Undisputed amounts remain due. Prices may exclude taxes, which are added where required. Chargebacks do not automatically cancel a subscription.' },
  { title: 'Pricing changes and notices', body: 'LayerNorm will disclose material price, renewal, and cancellation terms before purchase and provide notice of prospective subscription price changes. Consumer rights that cannot be waived continue to apply. Counsel must validate disclosures and cancellation flows for each offered jurisdiction.' },
]

export default function RefundsPage() {
  return <LegalPageTemplate label="Billing" title="Refund, Cancellation, and Usage Billing Terms" updated={LEGAL_EFFECTIVE_DATE} intro="These terms explain recurring charges, top-ups, usage reconciliation, cancellation, refunds, disputes, and taxes." sections={sections} crossLink={{ href: '/terms', label: 'Terms of Service' }} />
}
