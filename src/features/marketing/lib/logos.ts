export type LogoSpec = { light: string; dark?: string };

export const LOGO: Record<string, LogoSpec> = {
  claude: { light: "https://svgl.app/library/claude-ai-icon.svg" },
  openai: {
    light: "https://svgl.app/library/openai.svg",
    dark: "https://svgl.app/library/openai_dark.svg",
  },
  cursor: {
    light: "https://svgl.app/library/cursor_light.svg",
    dark: "https://svgl.app/library/cursor_dark.svg",
  },
  devin: {
    light: "/assets/svg/devin.svg",
    dark: "/assets/svg/devin_dark.svg",
  },
  apple: {
    light: "https://svgl.app/library/apple.svg",
    dark: "https://svgl.app/library/apple_dark.svg",
  },
  slack: { light: "https://svgl.app/library/slack.svg" },
  telegram: { light: "https://svgl.app/library/telegram.svg" },
  discord: { light: "https://svgl.app/library/discord.svg" },
  google: { light: "https://svgl.app/library/google.svg" },
};
