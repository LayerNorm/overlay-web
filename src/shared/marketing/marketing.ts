export const MARKETING_GITHUB_URL = "https://github.com/DevelopedByDev/overlay-web";
export const MARKETING_SALES_URL = "https://calendar.app.google/9vucWaH2jSE92mzn8";

export type AudiencePageKey = "business" | "education" | "content" | "developers";

export const AUDIENCE_PAGES: Array<{
  key: AudiencePageKey;
  href: string;
  label: string;
  navLabel: string;
  eyebrow: string;
  summary: string;
}> = [
  {
    key: "business",
    href: "/use-cases/business",
    label: "Overlay for business",
    navLabel: "Business",
    eyebrow: "Enterprise",
    summary: "Secure context, flexible model routing, and automations that move work forward.",
  },
  {
    key: "education",
    href: "/use-cases/education",
    label: "Overlay for education",
    navLabel: "Education",
    eyebrow: "Education",
    summary: "Research, guided study, and grounded notes across one organized workspace.",
  },
  {
    key: "content",
    href: "/use-cases/content",
    label: "Overlay for content",
    navLabel: "Content",
    eyebrow: "Content",
    summary: "Research, drafting, and multimodal generation without bouncing between tools.",
  },
  {
    key: "developers",
    href: "/use-cases/developers",
    label: "Overlay for developers",
    navLabel: "Developers",
    eyebrow: "Developers",
    summary: "Best-model routing, browser tasks, extensions, and open-source control.",
  },
];

export function getMarketingAppHref(isAuthenticated: boolean) {
  return isAuthenticated ? "/app/chat" : "/auth/sign-in?redirect=%2Fapp%2Fchat";
}
