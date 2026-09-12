import { LegalPageTemplate } from '@/features/marketing/components/LegalPageTemplate'
import { LEGAL_EFFECTIVE_DATE } from '@/shared/legal/legal-documents'

const sections = [
  { title: 'Necessary technologies', body: 'Overlay uses cookies and similar storage for authentication, session security, CSRF protection, load balancing, saved preferences, consent choices, and fraud prevention. Disabling these technologies may prevent the service from working.' },
  { title: 'Analytics', body: 'Where configured, PostHog, Vercel Analytics, and similar providers help LayerNorm understand feature use, reliability, and performance. Data may include page, device, approximate location, referrer, event, and pseudonymous account identifiers. LayerNorm should avoid recording message or file content in analytics.' },
  { title: 'Controls and consent', body: 'Browser controls can remove or block cookies. Product and analytics settings may provide additional choices. Where local law requires consent before non-essential analytics, LayerNorm will request it before activation and record the choice. Until a consent-management mechanism is deployed, non-essential analytics must remain disabled for affected users.' },
  { title: 'Retention and changes', body: 'Cookie duration ranges from the current session to the period needed for account preferences, security, and analytics. Provider-specific duration and a complete cookie table must be verified against production configuration before this notice is finalized.' },
]

export default function CookiesPage() {
  return <LegalPageTemplate label="Privacy" title="Cookie and Analytics Notice" updated={LEGAL_EFFECTIVE_DATE} intro="This notice explains how Overlay uses browser storage, cookies, and analytics technologies." sections={sections} crossLink={{ href: '/privacy', label: 'Privacy Policy' }} />
}
