import { LegalPageTemplate } from "@/features/marketing/components/LegalPageTemplate";

const PRIVACY = [
  {
    title: "What we collect",
    body: "We collect account information, authentication data, billing records, product events, diagnostics, and the content you choose to store or process through Overlay.",
  },
  {
    title: "How we use it",
    body: "We use data to run the product, authenticate you, process billing, sync your workspace, improve reliability, prevent abuse, and respond to support requests.",
  },
  {
    title: "AI providers",
    body: "When you use model-powered features, relevant prompts, files, and context may be sent to model providers so they can return a result. We route only what is needed for the request.",
  },
  {
    title: "Payments",
    body: "Payments are handled by Stripe. We do not store full card numbers. We keep billing status and transaction records needed to manage your account.",
  },
  {
    title: "We do not sell your data",
    body: "We do not sell personal information. We share data only with service providers, when you connect integrations, when required by law, or to protect Overlay and its users.",
  },
  {
    title: "Security",
    body: "We use reasonable safeguards for data in transit and at rest. No system is perfect, so keep your account credentials secure and tell us if something looks wrong.",
  },
  {
    title: "Your choices",
    body: "You can manage your account, disconnect integrations, request deletion, or contact us about access and correction requests.",
  },
  {
    title: "Retention",
    body: "We keep data while your account is active and as needed for product, security, billing, support, and legal reasons. Deletion requests are handled as quickly as practical.",
  },
];

export default function PrivacyPolicy() {
  return (
    <LegalPageTemplate
      label="Privacy"
      title="Privacy policy."
      updated="April 24, 2026"
      intro="Overlay is a workspace for real work, so privacy needs to be understandable. This page explains what we collect and why."
      sections={PRIVACY}
      crossLink={{ href: "/terms", label: "terms of service" }}
    />
  );
}
