export type ThemePreference = 'light' | 'dark'
/** Token streaming is the only supported mode; the field remains for API/storage compatibility. */
export type ChatStreamingMode = 'token'
export type ChatModePreference = 'ask' | 'act'
export type ModelPreference = 'same-for-each-chat' | 'different-for-each-chat'

export type ThemePresetId =
  | 'default-light'
  | 'default-dark'
  | 'absolutely-light'
  | 'catppuccin-light'
  | 'codex-light'
  | 'everforest-light'
  | 'github-light'
  | 'linear-light'
  | 'notion-light'
  | 'one-light'
  | 'proof-light'
  | 'raycast-light'
  | 'rose-pine-light'
  | 'absolutely'
  | 'codex'
  | 'catppuccin'
  | 'dracula'
  | 'everforest'
  | 'github'
  | 'gruvbox'
  | 'linear'
  | 'lobster'
  | 'material'
  | 'matrix'
  | 'monokai'
  | 'night-owl'
  | 'nord'
  | 'notion'
  | 'one'
  | 'oscurange'
  | 'raycast'
  | 'rose-pine'
  | 'sentry'
  | 'solarized'
  | 'temple'
  | 'tokyo-night'
  | 'vercel'
  | 'vscode-plus'
  | 'xcode'

export interface AppSettings {
  theme: ThemePreference
  lightThemePreset: ThemePresetId
  darkThemePreset: ThemePresetId
  chatStreamingMode: ChatStreamingMode
  autoContinue: boolean
  defaultChatMode: ChatModePreference
  modelPreference: ModelPreference
  defaultAskModelIds: string[]
  defaultActModelId?: string
  defaultImageModelId?: string
  defaultVideoModelId?: string
  defaultImageAspectRatio?: string
  defaultVideoAspectRatio?: string
  sendWithEnter: boolean
  attachFilesToKnowledgeByDefault: boolean
  onlyAllowZdrModels: boolean
  dismissedZdrWarningGlobally: boolean
  dismissedZdrWarningModelIds: string[]
  /** Chat model IDs shown in the user's model picker. Empty uses the curated default list. */
  enabledChatModelIds: string[]
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'light',
  lightThemePreset: 'default-light',
  darkThemePreset: 'default-dark',
  chatStreamingMode: 'token',
  autoContinue: false,
  defaultChatMode: 'act',
  modelPreference: 'same-for-each-chat',
  defaultAskModelIds: [],
  defaultActModelId: undefined,
  defaultImageModelId: undefined,
  defaultVideoModelId: undefined,
  defaultImageAspectRatio: undefined,
  defaultVideoAspectRatio: undefined,
  sendWithEnter: true,
  attachFilesToKnowledgeByDefault: false,
  onlyAllowZdrModels: false,
  dismissedZdrWarningGlobally: false,
  dismissedZdrWarningModelIds: [],
  enabledChatModelIds: [],
}

export interface ChatModel {
  id: string
  name: string
  provider:
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'groq'
    | 'xai'
    | 'openrouter'
    | 'minimax'
    | 'moonshotai'
    | 'zai'
    | 'alibaba'
    | string
  description?: string
  intelligence: number
  cost: 0 | 1 | 2 | 3
  /** Relative latency: 1 = heavier/slower, 3 = faster/lighter. */
  speedTier: 1 | 2 | 3
  supportsVision: boolean
  supportsReasoning: boolean
  supportsSearch: boolean
  supportsZeroDataRetention?: boolean
  /** Price per 1M blended tokens ($). */
  pricePer1mTokens?: number
  /** Median output tokens per second. */
  medianOutputTokensPerSecond?: number
}

export interface ImageModel {
  id: string
  name: string
  provider: string
  description?: string
  defaultAspectRatio?: string
}

export interface VideoModel {
  id: string
  name: string
  provider: string
  description?: string
  billingUnit: 'per_video' | 'per_second'
  defaultDuration?: number
  defaultAspectRatio?: string
}
