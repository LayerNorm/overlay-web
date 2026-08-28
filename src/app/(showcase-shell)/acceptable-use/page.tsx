import { LegalPageTemplate } from '@/features/marketing/components/LegalPageTemplate'
import { LEGAL_EFFECTIVE_DATE } from '@/shared/legal/legal-documents'

const sections = [
  { title: 'Use lawfully and safely', body: 'Do not use Overlay to violate law or another person’s rights; facilitate fraud, trafficking, exploitation, violence, or evasion of legal restrictions; produce or distribute malware; conduct unauthorized surveillance; or make high-impact decisions without required human review, notices, and safeguards.' },
  { title: 'Protect people and systems', body: 'Do not probe, scan, exploit, disrupt, overload, scrape, reverse engineer, or bypass Overlay or third-party systems without written authorization. Do not attempt credential theft, secret extraction, prompt injection against other users, denial of service, spam, phishing, impersonation, or unauthorized access.' },
  { title: 'Content and intellectual property', body: 'Do not submit, generate, or distribute content you lack rights to use; intimate imagery without consent; child sexual abuse material; content that unlawfully threatens or harasses; or material intended to deceive people about its origin where disclosure is required.' },
  { title: 'Models, tools, and sandboxes', body: 'You are responsible for tool permissions, agent actions, code execution, network requests, and resource consumption. Do not use sandboxes for cryptomining, botnets, credential attacks, prohibited scraping, or persistent hosting outside documented limits.' },
  { title: 'Enforcement and reporting', body: 'LayerNorm may rate-limit, block actions, remove content, suspend accounts, preserve evidence, or notify appropriate parties when reasonably necessary. Enforcement considers severity, recurrence, intent, risk, and legal obligations. Report abuse or suspected compromise to divyansh@layernorm.co.' },
]

export default function AcceptableUsePage() {
  return <LegalPageTemplate label="Policy" title="Acceptable Use Policy" updated={LEGAL_EFFECTIVE_DATE} intro="These rules protect users, providers, and the public when Overlay is used to connect models, tools, files, integrations, and sandboxes." sections={sections} crossLink={{ href: '/terms', label: 'Terms of Service' }} />
}
