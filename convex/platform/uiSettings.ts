import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const themeValidator = v.union(v.literal('light'), v.literal('dark'))
const chatModeValidator = v.union(v.literal('ask'), v.literal('act'))
const modelPreferenceValidator = v.union(v.literal('same-for-each-chat'), v.literal('different-for-each-chat'))
const chatStreamingModeValidator = v.literal('token')
const themePresetValidator = v.optional(v.string())
const MAX_MODEL_ID_LENGTH = 160
const MAX_ASK_MODEL_IDS = 4
const MAX_ENABLED_MODEL_IDS = 400
const MODEL_ID_PATTERN = /^[A-Za-z0-9._~:/@+-]+$/
const ASPECT_RATIO_PATTERN = /^\d{1,2}:\d{1,2}$/
const uiSettingsValidator = v.object({
  theme: themeValidator,
  lightThemePreset: v.optional(v.string()),
  darkThemePreset: v.optional(v.string()),
  useSecondarySidebar: v.boolean(),
  chatStreamingMode: chatStreamingModeValidator,
  autoContinue: v.boolean(),
  defaultChatMode: chatModeValidator,
  modelPreference: modelPreferenceValidator,
  defaultAskModelIds: v.array(v.string()),
  defaultActModelId: v.optional(v.string()),
  defaultImageModelId: v.optional(v.string()),
  defaultVideoModelId: v.optional(v.string()),
  defaultImageAspectRatio: v.optional(v.string()),
  defaultVideoAspectRatio: v.optional(v.string()),
  sendWithEnter: v.boolean(),
  attachFilesToKnowledgeByDefault: v.boolean(),
  onlyAllowZdrModels: v.boolean(),
  dismissedZdrWarningGlobally: v.boolean(),
  dismissedZdrWarningModelIds: v.array(v.string()),
  enabledChatModelIds: v.array(v.string()),
  modelOrder: v.array(v.string()),
})

function defaultUiSettings() {
  return {
    theme: 'light' as const,
    lightThemePreset: 'default-light' as const,
    darkThemePreset: 'default-dark' as const,
    useSecondarySidebar: false,
    chatStreamingMode: 'token' as const,
    autoContinue: false,
    defaultChatMode: 'act' as const,
    modelPreference: 'same-for-each-chat' as const,
    defaultAskModelIds: [] as string[],
    sendWithEnter: true,
    attachFilesToKnowledgeByDefault: false,
    onlyAllowZdrModels: false,
    dismissedZdrWarningGlobally: false,
    dismissedZdrWarningModelIds: [] as string[],
    enabledChatModelIds: [] as string[],
    modelOrder: [] as string[],
  }
}

function safeModelId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_MODEL_ID_LENGTH) return undefined
  if (!MODEL_ID_PATTERN.test(trimmed)) return undefined
  return trimmed
}

function safeModelIds(values: string[] | undefined, max = MAX_ASK_MODEL_IDS): string[] | undefined {
  if (!values) return undefined
  const next = values
    .map(safeModelId)
    .filter((value): value is string => Boolean(value))
    .slice(0, max)
  return Array.from(new Set(next))
}

function safeAspectRatio(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (!ASPECT_RATIO_PATTERN.test(trimmed)) return undefined
  return trimmed
}

async function getExistingSettings(
  ctx: QueryCtx | MutationCtx,
  userId: string,
) {
  return await ctx.db
    .query('userUiSettings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
}

export const getByServer = query({
  args: {
    userId: v.string(),
    serverSecret: v.string(),
  },
  returns: uiSettingsValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await getExistingSettings(ctx, args.userId)
    if (!existing) return defaultUiSettings()
    const settings = {
      theme: existing.theme,
      lightThemePreset: existing.lightThemePreset ?? 'default-light',
      darkThemePreset: existing.darkThemePreset ?? 'default-dark',
      useSecondarySidebar: existing.useSecondarySidebar,
      // Legacy rows may still store 'chunk'; always expose token-only to clients.
      chatStreamingMode:
        existing.chatStreamingMode === 'chunk' ? 'token' : (existing.chatStreamingMode ?? 'token'),
      autoContinue: existing.autoContinue ?? false,
      defaultChatMode: existing.defaultChatMode ?? 'act',
      modelPreference: existing.modelPreference ?? 'same-for-each-chat',
      defaultAskModelIds: safeModelIds(existing.defaultAskModelIds) ?? [],
      sendWithEnter: existing.sendWithEnter ?? true,
      attachFilesToKnowledgeByDefault: existing.attachFilesToKnowledgeByDefault ?? false,
      onlyAllowZdrModels: existing.onlyAllowZdrModels ?? false,
      dismissedZdrWarningGlobally: existing.dismissedZdrWarningGlobally ?? false,
      dismissedZdrWarningModelIds: safeModelIds(existing.dismissedZdrWarningModelIds, 100) ?? [],
      enabledChatModelIds: safeModelIds(existing.enabledChatModelIds, MAX_ENABLED_MODEL_IDS) ?? [],
      modelOrder: safeModelIds(existing.modelOrder, MAX_ENABLED_MODEL_IDS) ?? [],
    }
    return {
      ...settings,
      ...(safeModelId(existing.defaultActModelId) ? { defaultActModelId: safeModelId(existing.defaultActModelId) } : {}),
      ...(safeModelId(existing.defaultImageModelId) ? { defaultImageModelId: safeModelId(existing.defaultImageModelId) } : {}),
      ...(safeModelId(existing.defaultVideoModelId) ? { defaultVideoModelId: safeModelId(existing.defaultVideoModelId) } : {}),
      ...(safeAspectRatio(existing.defaultImageAspectRatio) ? { defaultImageAspectRatio: safeAspectRatio(existing.defaultImageAspectRatio) } : {}),
      ...(safeAspectRatio(existing.defaultVideoAspectRatio) ? { defaultVideoAspectRatio: safeAspectRatio(existing.defaultVideoAspectRatio) } : {}),
    }
  },
})

export const upsertByServer = mutation({
  args: {
    userId: v.string(),
    serverSecret: v.string(),
    theme: v.optional(themeValidator),
    lightThemePreset: themePresetValidator,
    darkThemePreset: themePresetValidator,
    useSecondarySidebar: v.optional(v.boolean()),
    /** Ignored if sent; persisted value is always `token`. */
    chatStreamingMode: v.optional(v.union(v.literal('token'), v.literal('chunk'))),
    autoContinue: v.optional(v.boolean()),
    defaultChatMode: v.optional(chatModeValidator),
    modelPreference: v.optional(modelPreferenceValidator),
    defaultAskModelIds: v.optional(v.array(v.string())),
    defaultActModelId: v.optional(v.string()),
    defaultImageModelId: v.optional(v.string()),
    defaultVideoModelId: v.optional(v.string()),
    defaultImageAspectRatio: v.optional(v.string()),
    defaultVideoAspectRatio: v.optional(v.string()),
    sendWithEnter: v.optional(v.boolean()),
    attachFilesToKnowledgeByDefault: v.optional(v.boolean()),
    onlyAllowZdrModels: v.optional(v.boolean()),
    dismissedZdrWarningGlobally: v.optional(v.boolean()),
    dismissedZdrWarningModelIds: v.optional(v.array(v.string())),
    enabledChatModelIds: v.optional(v.array(v.string())),
    modelOrder: v.optional(v.array(v.string())),
  },
  returns: uiSettingsValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const existing = await getExistingSettings(ctx, args.userId)
    const next = {
      theme: args.theme ?? existing?.theme ?? 'light' as const,
      lightThemePreset: args.lightThemePreset ?? existing?.lightThemePreset ?? 'default-light' as const,
      darkThemePreset: args.darkThemePreset ?? existing?.darkThemePreset ?? 'default-dark' as const,
      useSecondarySidebar: args.useSecondarySidebar ?? existing?.useSecondarySidebar ?? false,
      chatStreamingMode: 'token' as const,
      autoContinue: args.autoContinue ?? existing?.autoContinue ?? false,
      defaultChatMode: args.defaultChatMode ?? existing?.defaultChatMode ?? 'act' as const,
      modelPreference: args.modelPreference ?? existing?.modelPreference ?? 'same-for-each-chat' as const,
      defaultAskModelIds:
        safeModelIds(args.defaultAskModelIds) ?? safeModelIds(existing?.defaultAskModelIds) ?? [],
      sendWithEnter: args.sendWithEnter ?? existing?.sendWithEnter ?? true,
      attachFilesToKnowledgeByDefault:
        args.attachFilesToKnowledgeByDefault ?? existing?.attachFilesToKnowledgeByDefault ?? false,
      onlyAllowZdrModels: args.onlyAllowZdrModels ?? existing?.onlyAllowZdrModels ?? false,
      dismissedZdrWarningGlobally:
        args.dismissedZdrWarningGlobally ?? existing?.dismissedZdrWarningGlobally ?? false,
      dismissedZdrWarningModelIds:
        safeModelIds(args.dismissedZdrWarningModelIds, 100) ??
        safeModelIds(existing?.dismissedZdrWarningModelIds, 100) ??
        [],
      enabledChatModelIds:
        safeModelIds(args.enabledChatModelIds, MAX_ENABLED_MODEL_IDS) ??
        safeModelIds(existing?.enabledChatModelIds, MAX_ENABLED_MODEL_IDS) ??
        [],
      modelOrder:
        safeModelIds(args.modelOrder, MAX_ENABLED_MODEL_IDS) ??
        safeModelIds(existing?.modelOrder, MAX_ENABLED_MODEL_IDS) ??
        [],
    }
    const optionalNext = {
      ...(safeModelId(args.defaultActModelId) ?? safeModelId(existing?.defaultActModelId)
        ? { defaultActModelId: safeModelId(args.defaultActModelId) ?? safeModelId(existing?.defaultActModelId) }
        : {}),
      ...(safeModelId(args.defaultImageModelId) ?? safeModelId(existing?.defaultImageModelId)
        ? { defaultImageModelId: safeModelId(args.defaultImageModelId) ?? safeModelId(existing?.defaultImageModelId) }
        : {}),
      ...(safeModelId(args.defaultVideoModelId) ?? safeModelId(existing?.defaultVideoModelId)
        ? { defaultVideoModelId: safeModelId(args.defaultVideoModelId) ?? safeModelId(existing?.defaultVideoModelId) }
        : {}),
      ...(safeAspectRatio(args.defaultImageAspectRatio) ?? safeAspectRatio(existing?.defaultImageAspectRatio)
        ? { defaultImageAspectRatio: safeAspectRatio(args.defaultImageAspectRatio) ?? safeAspectRatio(existing?.defaultImageAspectRatio) }
        : {}),
      ...(safeAspectRatio(args.defaultVideoAspectRatio) ?? safeAspectRatio(existing?.defaultVideoAspectRatio)
        ? { defaultVideoAspectRatio: safeAspectRatio(args.defaultVideoAspectRatio) ?? safeAspectRatio(existing?.defaultVideoAspectRatio) }
        : {}),
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...next,
        ...optionalNext,
        updatedAt: now,
      })
    } else {
      await ctx.db.insert('userUiSettings', {
        userId: args.userId,
        ...next,
        ...optionalNext,
        createdAt: now,
        updatedAt: now,
      })
    }

    return { ...next, ...optionalNext }
  },
})
