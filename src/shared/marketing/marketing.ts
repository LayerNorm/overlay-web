export const MARKETING_GITHUB_URL =
  "https://github.com/LayerNorm/overlay-web";
export const MARKETING_DISCORD_URL = "https://discord.gg/cag4HPkU6Z";
export const MARKETING_SALES_URL =
  "https://calendar.app.google/9vucWaH2jSE92mzn8";
/** Canonical documentation surface served from the primary Overlay domain. */
export const MARKETING_DOCS_URL = "https://overlay.works/docs";
/** Adds the Workspace Overlay to a Slack workspace; signs the visitor in first when needed. */
export const MARKETING_SLACK_INSTALL_PATH = "/api/v1/integrations/slack/install";
/** How to reach Overlay from ChatGPT, Claude and other MCP apps. */
export const MARKETING_MCP_DOCS_URL = `${MARKETING_DOCS_URL}/help/connect-other-apps`;
/** Private deployment / design partner inquiries reuse the sales calendar for now. */
export const MARKETING_DEPLOY_URL = MARKETING_SALES_URL;

export function getMarketingAppHref(isAuthenticated: boolean) {
  return isAuthenticated ? "/app/work" : "/auth/sign-in?redirect=%2Fapp%2Fwork";
}
