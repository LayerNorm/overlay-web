import { z } from 'zod'
import { AuthFields, UnknownResponse } from './common'

export const SettingsQuery = z.object({})

export const BillingSettingsQuery = z.object({})

export const UpdateSettingsRequest = z.object({
  ...AuthFields,
  theme: z.enum(['light', 'dark']).optional(),
  lightThemePreset: z.string().optional(),
  darkThemePreset: z.string().optional(),
  autoContinue: z.boolean().optional(),
  defaultChatMode: z.enum(['ask', 'act']).optional(),
  modelPreference: z.enum(['same-for-each-chat', 'different-for-each-chat']).optional(),
  defaultAskModelIds: z.array(z.string()).optional(),
  defaultActModelId: z.string().optional(),
  defaultImageModelId: z.string().optional(),
  defaultVideoModelId: z.string().optional(),
  defaultImageAspectRatio: z.string().optional(),
  defaultVideoAspectRatio: z.string().optional(),
  sendWithEnter: z.boolean().optional(),
  attachFilesToKnowledgeByDefault: z.boolean().optional(),
  onlyAllowZdrModels: z.boolean().optional(),
  dismissedZdrWarningGlobally: z.boolean().optional(),
  dismissedZdrWarningModelIds: z.array(z.string()).optional(),
  chatStreamingMode: z.enum(['token', 'chunk']).optional(),
}).passthrough()

export const UpdateBillingSettingsRequest = z.object({
  ...AuthFields,
  autoTopUpEnabled: z.boolean(),
  confirmation: z.literal('UPDATE_BILLING_SETTINGS'),
  grantOffSessionConsent: z.boolean().optional(),
  topUpAmountCents: z.number().optional(),
  autoTopUpAmountCents: z.number().optional(),
}).passthrough()

export const SettingsResponse = UnknownResponse
