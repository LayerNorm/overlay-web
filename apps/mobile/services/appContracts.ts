export type ThemePreference = 'light' | 'dark'

export interface UiSettings {
  theme: ThemePreference
  useSecondarySidebar: boolean
}

export interface Entitlements {
  tier: 'free' | 'pro' | 'max'
  creditsUsed: number
  creditsTotal: number
  dailyUsage: { ask: number; write: number; agent: number }
  dailyLimits?: { ask: number; write: number; agent: number }
  overlayStorageBytesUsed?: number
  overlayStorageBytesLimit?: number
  transcriptionSecondsUsed?: number
  transcriptionSecondsLimit?: number
  localTranscriptionEnabled?: boolean
  resetAt?: string
  billingPeriodEnd?: string
  lastSyncedAt?: number
}

export interface AppUser {
  id: string
  email: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
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
  description?: string
  intelligence: number
  cost: 0 | 1 | 2 | 3
  supportsVision: boolean
  supportsReasoning: boolean
  supportsSearch: boolean
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

export interface AppDestinationConfig {
  id:
    | 'chat'
    | 'notes'
    | 'knowledge'
    | 'extensions'
    | 'projects'
    | 'automations'
    | 'settings'
    | 'account'
  label: string
  href: string
  subviews?: string[]
}

export interface AppBootstrap {
  user: AppUser | null
  entitlements: Entitlements | null
  uiSettings: UiSettings
  chatModels: ChatModel[]
  imageModels: ImageModel[]
  videoModels: VideoModel[]
  featureFlags: {
    canUseVoiceTranscription: boolean
    canUseKnowledge: boolean
    canUseProjects: boolean
    canUseAutomations: boolean
    canUseExtensions: boolean
  }
  destinations: AppDestinationConfig[]
  defaults?: {
    chatModelId?: string
    imageModelId?: string
    videoModelId?: string
  }
}

export interface ConversationSummary {
  _id: string
  title: string
  lastModified: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
  lastMode: 'ask' | 'act'
  askModelIds: string[]
  actModelId: string
  clientId?: string
  projectId?: string
}

export type ConversationMessagePart =
  | { type: 'text'; text?: string }
  | { type: 'file'; url?: string; mediaType?: string }
  | {
      type: 'tool-invocation'
      toolInvocation: {
        toolCallId?: string
        toolName: string
        state?: string
        toolInput?: Record<string, unknown>
        toolOutput?: unknown
      }
    }

export interface ConversationMessage {
  id: string
  turnId: string
  mode: 'ask' | 'act'
  contentType: 'text' | 'image' | 'video'
  variantIndex?: number
  role: 'user' | 'assistant'
  parts: ConversationMessagePart[]
  model?: string
  replyToTurnId?: string
  replySnippet?: string
  routedModelId?: string
}

export interface NoteDoc {
  _id: string
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
  clientId?: string
  projectId?: string
}

export interface KnowledgeFile {
  _id: string
  name: string
  type: 'file' | 'folder'
  parentId: string | null
  content?: string
  sizeBytes?: number
  isStorageBacked?: boolean
  downloadUrl?: string
  createdAt: number
  updatedAt: number
  projectId?: string
}

export interface MemoryRow {
  key: string
  memoryId: string
  segmentIndex: number
  content: string
  fullContent: string
  source: string
  createdAt: number
  updatedAt?: number
}

export interface OutputSummary {
  _id: string
  type: string
  source?: string
  status: 'pending' | 'completed' | 'failed'
  prompt: string
  modelId: string
  url?: string
  fileName?: string
  mimeType?: string
  sizeBytes?: number
  metadata?: Record<string, unknown>
  errorMessage?: string
  createdAt: number
  completedAt?: number
}

export interface IntegrationSummary {
  slug: string
  name: string
  description: string
  logoUrl: string | null
  isConnected: boolean
  connectedAccountId?: string | null
}

export interface SkillSummary {
  _id: string
  name: string
  description: string
  instructions: string
  enabled?: boolean
  projectId?: string
}

export interface ProjectSummary {
  _id: string
  name: string
  description?: string
  instructions?: string
  updatedAt: number
  createdAt: number
}

export interface AutomationSummary {
  _id: string
  title: string
  description?: string
  mode: 'ask' | 'act'
  modelId: string
  status: 'active' | 'paused' | 'archived'
  timezone: string
  scheduleKind: string
  scheduleConfig: Record<string, unknown>
  readinessState?: string
  readinessMessage?: string
  lastRunStatus?: string
  nextRunAt?: number
  updatedAt: number
}

export interface AutomationRunSummary {
  _id: string
  automationId: string
  status: string
  stage: string
  triggerSource?: 'manual' | 'schedule' | 'retry'
  startedAt?: number
  finishedAt?: number
  createdAt?: number
  assistantMessage?: string
  resultSummary?: string
  errorMessage?: string
}

export interface AutomationToolInvocationSummary {
  _id: string
  toolId: string
  mode: 'ask' | 'act'
  modelId?: string
  conversationId?: string
  turnId?: string
  success: boolean
  durationMs?: number
  costBucket: string
  errorMessage?: string
  createdAt: number
}

export interface AutomationRunEventSummary {
  _id: string
  automationRunId: string
  stage: string
  level: 'info' | 'warning' | 'error'
  message: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface AutomationRunDetail {
  run: AutomationRunSummary
  automation?: Pick<AutomationSummary, '_id' | 'title' | 'description' | 'mode' | 'modelId'>
  userMessage?: string
  assistantMessage?: string
  outputs?: OutputSummary[]
  tools?: AutomationToolInvocationSummary[]
  relatedRetryRun?: AutomationRunSummary
  events?: AutomationRunEventSummary[]
}
