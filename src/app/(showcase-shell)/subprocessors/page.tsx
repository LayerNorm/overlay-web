import { LegalPageTemplate } from '@/features/marketing/components/LegalPageTemplate'
import { LEGAL_EFFECTIVE_DATE } from '@/shared/legal/legal-documents'

const sections = [
  { title: 'Infrastructure and platform', body: 'Vercel provides web hosting and serverless infrastructure. Convex and/or Neon may provide application databases depending on the deployment. Cloudflare may provide network, security, DNS, and object-storage services. Production owners must verify the exact provider, region, and purpose before this list is finalized.' },
  { title: 'Authentication, payments, and communications', body: 'WorkOS and/or Better Auth infrastructure may process identity and session data. Stripe processes billing and payment information. Resend processes transactional email delivery. Provider selection depends on deployment configuration.' },
  { title: 'AI, tools, and sandboxes', body: 'Model and tool providers may include OpenAI, Anthropic, Google, OpenRouter, Groq, and providers selected by the customer. Vercel Sandbox and other configured sandbox providers may process code, files, commands, and network requests. Only providers actually enabled for a customer receive its data.' },
  { title: 'Analytics and reliability', body: 'PostHog, Vercel Analytics, Sentry, and similar configured services may process product events, diagnostics, and technical metadata. Production configuration must be verified against this list and the Cookie Notice.' },
  { title: 'Changes and objections', body: 'A signed DPA will describe advance notice and objection rights for new subprocessors. LayerNorm must establish a subscription mechanism and change log before representing that this page provides contractual notice.' },
]

export default function SubprocessorsPage() {
  return <LegalPageTemplate label="Privacy" title="Subprocessor List" updated={LEGAL_EFFECTIVE_DATE} intro="This draft inventory identifies provider categories used by Overlay; deployment owners must verify the exact production list, regions, and purposes." sections={sections} crossLink={{ href: '/dpa', label: 'Data Processing Addendum' }} />
}
