import { LegalPageTemplate } from '@/features/marketing/components/LegalPageTemplate'
import { LEGAL_EFFECTIVE_DATE } from '@/shared/legal/legal-documents'

const sections = [
  { title: 'Copyright notices', body: 'A notice should identify the copyrighted work, identify the material to remove with information sufficient to locate it, provide the complaining party’s contact information, state a good-faith belief that use is unauthorized, state under penalty of perjury that the notice is accurate and the sender is authorized, and include a physical or electronic signature.' },
  { title: 'Counter-notices', body: 'A counter-notice should identify the removed material and its former location, state under penalty of perjury that removal resulted from mistake or misidentification, provide the sender’s name, address, and telephone number, consent to the appropriate federal court jurisdiction, accept service from the original complainant, and include a signature.' },
  { title: 'Process', body: 'LayerNorm may forward notices and counter-notices, remove or restore material, preserve evidence, terminate repeat infringers where appropriate, and take other steps required by law. Knowingly material misrepresentations may create liability. Parties should obtain legal advice before submitting a notice.' },
  { title: 'Designated agent status', body: 'Send preliminary copyright reports to divyansh@layernorm.co. This address is not represented as a registered DMCA designated agent until LayerNorm’s counsel confirms eligibility, LayerNorm registers the agent with the U.S. Copyright Office, and the required public name, address, phone, and email are published here. LayerNorm must not claim Section 512 safe-harbor compliance before those steps are complete.' },
]

export default function DmcaPage() {
  return <LegalPageTemplate label="Copyright" title="DMCA and Takedown Policy" updated={LEGAL_EFFECTIVE_DATE} intro="This draft describes how LayerNorm expects to receive and respond to copyright notices and counter-notices for user-provided material." sections={sections} crossLink={{ href: '/acceptable-use', label: 'Acceptable Use Policy' }} />
}
