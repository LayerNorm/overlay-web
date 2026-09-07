import { LegalPageTemplate } from '@/features/marketing/components/LegalPageTemplate'
import { LEGAL_DOCUMENTS, LEGAL_EFFECTIVE_DATE } from '@/shared/legal/legal-documents'

const sections = [
  {
    title: 'Agreement and eligibility',
    body: [
      `These Terms of Service (version ${LEGAL_DOCUMENTS.terms.version}) are a binding agreement between you and LayerNorm Inc. governing Overlay's hosted services, websites, applications, APIs, and support. By creating an account, clicking acceptance, purchasing, or using the service, you agree to these Terms and acknowledge the Privacy Policy.`,
      'You must be legally able to form a contract and at least 18 years old, or the age of majority where you live. If you use Overlay for an organization, you represent that you can bind that organization. You may not use the service if applicable law prohibits it.',
    ],
  },
  {
    title: 'Accounts and security',
    body: 'Provide accurate information, keep credentials and API keys confidential, use appropriate access controls, and notify LayerNorm promptly of suspected compromise. You are responsible for activity under your account and for authorized workspace members, except to the extent caused by LayerNorm. Accounts may not be shared in a way that defeats plan limits or security controls.',
  },
  {
    title: 'Acceptable use',
    body: 'You must follow the Acceptable Use Policy. LayerNorm may investigate abuse, preserve evidence, restrict risky integrations, and suspend or terminate access when reasonably necessary to protect users, LayerNorm, providers, or the public, comply with law, prevent fraud, or address a material breach.',
  },
  {
    title: 'Plans, charges, renewals, and taxes',
    body: [
      'Paid subscriptions renew automatically at the interval and price disclosed at checkout until canceled. Usage charges, top-ups, provider pass-through costs, overages, minimum commitments, and taxes are additional when disclosed for your plan. You authorize LayerNorm and its payment processor to charge the selected payment method for recurring and usage-based amounts.',
      'Prices may change prospectively after reasonable notice. You are responsible for applicable taxes other than taxes on LayerNorm income. Failed or disputed payments may result in restricted service. The Refund, Cancellation, and Usage Billing Terms are incorporated into these Terms.',
    ],
  },
  {
    title: 'Cancellation, refunds, and payment disputes',
    body: 'You may cancel through the billing portal or another method LayerNorm makes available. Cancellation stops future renewal but ordinarily does not refund the current period or consumed usage, except where law requires or the Refund Policy says otherwise. Contact LayerNorm before initiating a chargeback so it can investigate. Nothing limits non-waivable consumer rights.',
  },
  {
    title: 'Your content and instructions',
    body: [
      'You retain ownership of content you submit, connect, upload, generate, or share. You grant LayerNorm a worldwide, non-exclusive license to host, copy, transmit, display, modify, and process that content only as needed to operate, secure, support, and improve the service, follow your instructions, enforce these Terms, and comply with law. This license ends when the content is deleted, subject to backups, legal retention, and de-identified data.',
      'You represent that you have the rights and permissions needed for your content, prompts, data sources, instructions, and integrations. You control sharing and workspace permissions and are responsible for notices and consents required from people whose information you process.',
    ],
  },
  {
    title: 'AI systems and outputs',
    body: 'AI output may be inaccurate, incomplete, offensive, non-unique, or unsuitable. Do not rely on it as legal, medical, financial, safety-critical, or other professional advice. Review outputs and tool actions before use. You are responsible for decisions, publications, and actions taken from outputs. LayerNorm does not represent that output is protectable, original, or free of third-party rights.',
  },
  {
    title: 'Third-party services and integrations',
    body: 'Models, connectors, identity providers, payment services, hosting, sandboxes, and other integrations are operated by third parties under their own terms and privacy practices. You authorize LayerNorm to send the data and instructions needed to use integrations you enable. LayerNorm is not responsible for third-party availability, output, security, or changes, but will use commercially reasonable care in selecting and integrating providers.',
  },
  {
    title: 'LayerNorm rights and open-source software',
    body: 'LayerNorm and its licensors own the service, branding, proprietary hosted components, and related intellectual property. These Terms grant only a limited, revocable, non-transferable right to use the hosted service. Open-source components are governed by their license files, including AGPL-3.0-only where applicable. No trademark rights are granted.',
  },
  {
    title: 'Confidentiality and feedback',
    body: 'Each party will use reasonable care to protect non-public information marked or reasonably understood as confidential and will use it only for the relationship, subject to customary legal and independently-developed-information exceptions. You grant LayerNorm a perpetual, irrevocable, royalty-free right to use feedback without restriction or attribution obligation.',
  },
  {
    title: 'Availability, changes, and beta features',
    body: 'The service may change, experience interruptions, or discontinue features. Beta, preview, trial, and experimental features may be changed or withdrawn at any time and are provided without service commitments. LayerNorm will use commercially reasonable efforts to avoid materially reducing paid core functionality during a current term, subject to security, law, and provider changes.',
  },
  {
    title: 'Termination and data export',
    body: 'You may stop using Overlay at any time. LayerNorm may suspend or terminate for material breach, nonpayment, security risk, unlawful use, provider requirement, or discontinuation, and will give notice and an opportunity to cure when reasonable. On termination, payment obligations accrued remain due. Export or deletion options may be limited after termination; retain your own backups.',
  },
  {
    title: 'Disclaimers',
    body: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” LAYERNORM DISCLAIMS IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND WARRANTIES ARISING FROM COURSE OF DEALING. LAYERNORM DOES NOT WARRANT UNINTERRUPTED, ERROR-FREE, SECURE, OR ACCURATE OPERATION. NON-WAIVABLE WARRANTIES REMAIN UNAFFECTED.',
  },
  {
    title: 'Limitation of liability',
    body: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES OR LOST PROFITS, REVENUE, DATA, OR GOODWILL. EACH PARTY’S AGGREGATE LIABILITY ARISING FROM THE SERVICE WILL NOT EXCEED THE GREATER OF USD $100 OR AMOUNTS YOU PAID LAYERNORM FOR THE SERVICE IN THE 12 MONTHS BEFORE THE EVENT. The cap does not apply where prohibited by law or to payment obligations, fraud, willful misconduct, confidentiality breaches, or indemnity obligations to the extent counsel confirms.',
  },
  {
    title: 'Indemnification',
    body: 'You will defend and indemnify LayerNorm and its personnel against third-party claims arising from your content, unlawful use, violation of these Terms, or infringement caused by your instructions or integrations. LayerNorm will provide prompt notice and reasonable cooperation and will allow you to control the defense, subject to LayerNorm approving settlements that impose obligations or admissions on it. Any LayerNorm indemnity must appear in a signed commercial agreement.',
  },
  {
    title: 'Governing law and disputes',
    body: 'These Terms are governed by Delaware law, excluding conflict-of-law rules. The parties consent to exclusive jurisdiction and venue in the state and federal courts located in Delaware. Before filing a claim, each party will give written notice and attempt in good faith to resolve it for 30 days. Mandatory consumer-law rights and small-claims rights remain unaffected. Counsel must confirm this clause before launch.',
  },
  {
    title: 'Changes and notices',
    body: 'LayerNorm may update these Terms prospectively. Material changes will be announced through the service, email, or another reasonable channel and will state the effective date. If law requires renewed consent, LayerNorm will request it. Electronic notices are effective when sent to your account email or displayed in the service.',
  },
  {
    title: 'General terms',
    body: 'Neither party may assign these Terms without consent, except LayerNorm may assign them in a merger, reorganization, financing, or sale of substantially all relevant assets. Failure to enforce is not a waiver. Invalid provisions will be narrowed or severed. Neither party is liable for events beyond reasonable control. These Terms and incorporated policies are the entire agreement for the hosted service unless a signed order form, DPA, or commercial agreement states otherwise.',
  },
]

export default function TermsPage() {
  return <LegalPageTemplate label="Legal" title="Terms of Service" updated={`${LEGAL_EFFECTIVE_DATE} · Version ${LEGAL_DOCUMENTS.terms.version}`} intro="These terms govern use of Overlay's hosted services, subscriptions, integrations, user content, and AI features." sections={sections} crossLink={{ href: '/privacy', label: 'Privacy Policy' }} />
}
