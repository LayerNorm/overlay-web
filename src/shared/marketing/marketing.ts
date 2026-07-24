export const MARKETING_GITHUB_URL =
  "https://github.com/DevelopedByDev/overlay-web";
export const MARKETING_SALES_URL =
  "https://calendar.app.google/9vucWaH2jSE92mzn8";
/** Canonical documentation surface served from the primary Overlay domain. */
export const MARKETING_DOCS_URL = "https://getoverlay.io/docs";
/** Private deployment / design partner inquiries reuse the sales calendar for now. */
export const MARKETING_DEPLOY_URL = MARKETING_SALES_URL;

export function getMarketingAppHref(isAuthenticated: boolean) {
  return isAuthenticated ? "/app/chat" : "/auth/sign-in?redirect=%2Fapp%2Fchat";
}
