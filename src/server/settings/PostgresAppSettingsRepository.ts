import 'server-only'

import { DEFAULT_APP_SETTINGS, type AppSettings } from '@overlay/app-core'
import { eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { userSettings } from '@/server/database/postgres/schema'
import type { AppSettingsPatch, AppSettingsRepository } from './AppSettingsRepository'

export class PostgresAppSettingsRepository implements AppSettingsRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getByUserId(userId: string): Promise<AppSettings> {
    const [row] = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1)

    return row ? settingsFromRow(row) : DEFAULT_APP_SETTINGS
  }

  async updateForUserId(userId: string, patch: AppSettingsPatch): Promise<AppSettings> {
    const now = new Date()
    await this.db
      .insert(userSettings)
      .values({
        userId,
        ...settingsToColumns(patch),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          ...settingsToColumns(patch),
          updatedAt: now,
        },
      })

    return this.getByUserId(userId)
  }
}

type UserSettingsRow = typeof userSettings.$inferSelect

function isLinkOpenPreference(value: string | null): value is AppSettings['linkOpenPreference'] {
  return value === 'ask' || value === 'overlay' || value === 'new-tab'
}

function settingsFromRow(row: UserSettingsRow): AppSettings {
  return {
    theme: row.theme === 'dark' ? 'dark' : DEFAULT_APP_SETTINGS.theme,
    lightThemePreset: (row.lightThemePreset ?? DEFAULT_APP_SETTINGS.lightThemePreset) as AppSettings['lightThemePreset'],
    darkThemePreset: (row.darkThemePreset ?? DEFAULT_APP_SETTINGS.darkThemePreset) as AppSettings['darkThemePreset'],
    chatStreamingMode: row.chatStreamingMode === 'token' ? 'token' : DEFAULT_APP_SETTINGS.chatStreamingMode,
    autoContinue: row.autoContinue ?? DEFAULT_APP_SETTINGS.autoContinue,
    linkOpenPreference: isLinkOpenPreference(row.linkOpenPreference)
      ? row.linkOpenPreference
      : DEFAULT_APP_SETTINGS.linkOpenPreference,
    defaultChatMode: row.defaultChatMode ?? DEFAULT_APP_SETTINGS.defaultChatMode,
    modelPreference: row.modelPreference === 'different-for-each-chat'
      ? 'different-for-each-chat'
      : DEFAULT_APP_SETTINGS.modelPreference,
    defaultAskModelIds: row.defaultAskModelIds ?? DEFAULT_APP_SETTINGS.defaultAskModelIds,
    defaultActModelId: row.defaultActModelId ?? undefined,
    defaultImageModelId: row.defaultImageModelId ?? undefined,
    defaultVideoModelId: row.defaultVideoModelId ?? undefined,
    defaultImageAspectRatio: row.defaultImageAspectRatio ?? undefined,
    defaultVideoAspectRatio: row.defaultVideoAspectRatio ?? undefined,
    sendWithEnter: row.sendWithEnter ?? DEFAULT_APP_SETTINGS.sendWithEnter,
    attachFilesToKnowledgeByDefault: row.attachFilesToKnowledgeByDefault ?? DEFAULT_APP_SETTINGS.attachFilesToKnowledgeByDefault,
    onlyAllowZdrModels: row.onlyAllowZdrModels ?? DEFAULT_APP_SETTINGS.onlyAllowZdrModels,
    dismissedZdrWarningGlobally: row.dismissedZdrWarningGlobally ?? DEFAULT_APP_SETTINGS.dismissedZdrWarningGlobally,
    dismissedZdrWarningModelIds: row.dismissedZdrWarningModelIds ?? DEFAULT_APP_SETTINGS.dismissedZdrWarningModelIds,
    enabledChatModelIds: row.enabledChatModelIds ?? DEFAULT_APP_SETTINGS.enabledChatModelIds,
    modelOrder: row.modelOrder ?? DEFAULT_APP_SETTINGS.modelOrder,
  }
}

function settingsToColumns(patch: AppSettingsPatch): Partial<typeof userSettings.$inferInsert> {
  const columns: Partial<typeof userSettings.$inferInsert> = {}
  if (patch.theme !== undefined) columns.theme = patch.theme
  if (patch.lightThemePreset !== undefined) columns.lightThemePreset = patch.lightThemePreset
  if (patch.darkThemePreset !== undefined) columns.darkThemePreset = patch.darkThemePreset
  if (patch.chatStreamingMode !== undefined) columns.chatStreamingMode = patch.chatStreamingMode
  if (patch.autoContinue !== undefined) columns.autoContinue = patch.autoContinue
  if (patch.linkOpenPreference !== undefined) columns.linkOpenPreference = patch.linkOpenPreference
  if (patch.defaultChatMode !== undefined) columns.defaultChatMode = patch.defaultChatMode
  if (patch.modelPreference !== undefined) columns.modelPreference = patch.modelPreference
  if (patch.defaultAskModelIds !== undefined) columns.defaultAskModelIds = patch.defaultAskModelIds
  if (patch.defaultActModelId !== undefined) columns.defaultActModelId = patch.defaultActModelId
  if (patch.defaultImageModelId !== undefined) columns.defaultImageModelId = patch.defaultImageModelId
  if (patch.defaultVideoModelId !== undefined) columns.defaultVideoModelId = patch.defaultVideoModelId
  if (patch.defaultImageAspectRatio !== undefined) columns.defaultImageAspectRatio = patch.defaultImageAspectRatio
  if (patch.defaultVideoAspectRatio !== undefined) columns.defaultVideoAspectRatio = patch.defaultVideoAspectRatio
  if (patch.sendWithEnter !== undefined) columns.sendWithEnter = patch.sendWithEnter
  if (patch.attachFilesToKnowledgeByDefault !== undefined) {
    columns.attachFilesToKnowledgeByDefault = patch.attachFilesToKnowledgeByDefault
  }
  if (patch.onlyAllowZdrModels !== undefined) columns.onlyAllowZdrModels = patch.onlyAllowZdrModels
  if (patch.dismissedZdrWarningGlobally !== undefined) {
    columns.dismissedZdrWarningGlobally = patch.dismissedZdrWarningGlobally
  }
  if (patch.dismissedZdrWarningModelIds !== undefined) {
    columns.dismissedZdrWarningModelIds = patch.dismissedZdrWarningModelIds
  }
  if (patch.enabledChatModelIds !== undefined) columns.enabledChatModelIds = patch.enabledChatModelIds
  if (patch.modelOrder !== undefined) columns.modelOrder = patch.modelOrder
  return columns
}
