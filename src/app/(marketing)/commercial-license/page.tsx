import { LegalPageTemplate } from '@/features/marketing/components/LegalPageTemplate'
import { LEGAL_EFFECTIVE_DATE } from '@/shared/legal/legal-documents'

const sections = [
  { title: 'Open-source option', body: 'First-party material in the public repository is available under AGPL-3.0-only, subject to repository notices, third-party licenses, and trademark rules. Network use of a modified version may require offering Corresponding Source under AGPL section 13.' },
  { title: 'Commercial option', body: 'LayerNorm may offer paid terms for proprietary modifications, private distribution, embedded products, support, maintenance, warranties, indemnities, service levels, or negotiated enterprise requirements.' },
  { title: 'No rights from this page', body: 'This page is not a license or offer. Commercial rights exist only in a definitive written agreement signed by LayerNorm Inc. Scope, affiliates, environments, users, duration, fees, audit rights, restrictions, support, and termination are negotiated.' },
  { title: 'Request terms', body: 'Contact divyansh@layernorm.co with the intended deployment model, distribution, number of users or customers, source-modification plan, support needs, and required procurement terms.' },
]

export default function CommercialLicensePage() {
  return <LegalPageTemplate label="Licensing" title="Commercial Licensing" updated={LEGAL_EFFECTIVE_DATE} intro="Organizations that need terms outside AGPL-3.0-only can request a separate paid commercial agreement from LayerNorm." sections={sections} crossLink={{ href: 'https://github.com/LayerNorm/overlay-web', label: 'open-source repository' }} />
}
