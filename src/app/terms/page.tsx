import { LegalPageTemplate } from "@/features/marketing/components/LegalPageTemplate";

const TERMS = [
  {
    title: "Use Overlay responsibly",
    body: "Do not use Overlay to break the law, abuse other people, violate rights, distribute malware, spam, or try to disrupt the service.",
  },
  {
    title: "You own your work",
    body: "You keep ownership of the prompts, files, notes, chats, and outputs you create. You are responsible for what you upload, generate, share, or rely on.",
  },
  {
    title: "AI can be wrong",
    body: "Model outputs can be inaccurate, incomplete, biased, or unsafe for important decisions. Review outputs before using them, especially for legal, medical, financial, or other high-stakes work.",
  },
  {
    title: "Paid plans and billing",
    body: "Paid plans renew until canceled. You can manage billing from your account. Usage-based features may draw from your monthly budget or top-up balance.",
  },
  {
    title: "Third-party services",
    body: "Overlay connects to model providers, authentication, payments, hosting, and other services. Their terms may also apply when you use those parts of the product.",
  },
  {
    title: "Availability",
    body: "We work to keep Overlay reliable, but the service is provided as is and may change, pause, or fail. We are not liable for indirect damages or losses from using the service.",
  },
  {
    title: "Account access",
    body: "Keep your account secure. We may suspend access if we believe an account is unsafe, abusive, fraudulent, or violating these terms.",
  },
  {
    title: "Changes",
    body: "We may update these terms as the product changes. Continuing to use Overlay after an update means you accept the new terms.",
  },
];

export default function TermsOfService() {
  return (
    <LegalPageTemplate
      label="Legal"
      title="Terms of service."
      updated="April 24, 2026"
      intro="These terms are the rules for using Overlay. The short version: use the product legally, keep your account secure, and review AI outputs before relying on them."
      sections={TERMS}
      crossLink={{ href: "/privacy", label: "privacy policy" }}
    />
  );
}
