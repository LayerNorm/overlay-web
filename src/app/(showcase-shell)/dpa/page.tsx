import { LegalPageTemplate } from '@/features/marketing/components/LegalPageTemplate'
import { LEGAL_EFFECTIVE_DATE } from '@/shared/legal/legal-documents'

const sections = [
  { title: 'Status', body: 'This page is a DPA readiness notice, not an executed Data Processing Addendum. Customers requiring processor terms must sign a counsel-approved DPA with LayerNorm before submitting regulated or contractually restricted personal data.' },
  { title: 'Required agreement terms', body: 'The final DPA will address documented instructions, confidentiality, security measures, subprocessors, assistance with data-subject requests, breach notification, deletion or return, audits, international transfers, and allocation of controller and processor responsibilities.' },
  { title: 'Processing details', body: 'The final exhibits must identify subject matter, duration, purpose, data subjects, data categories, sensitive-data restrictions, retention, approved regions, subprocessors, transfer mechanisms, and technical and organizational measures for the purchased service.' },
  { title: 'Customer responsibilities', body: 'Customers remain responsible for lawful instructions, required notices and consents, account configuration, access governance, data minimization, and determining whether Overlay is suitable for their data. Regulated workloads require written approval and the applicable commercial terms.' },
  { title: 'Request a DPA', body: 'Contact divyansh@layernorm.co. A signed order form or other commercial agreement must identify the customer legal entity and control if it conflicts with this informational page.' },
]

export default function DpaPage() {
  return <LegalPageTemplate label="Privacy" title="Data Processing Addendum" updated={LEGAL_EFFECTIVE_DATE} intro="LayerNorm is preparing a counsel-approved DPA for customers that use Overlay to process personal data on their behalf." sections={sections} crossLink={{ href: '/subprocessors', label: 'Subprocessor List' }} />
}
