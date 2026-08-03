import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AppSettings, ChatModePreference, ThemePresetId } from '@overlay/app-core'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { isThemePresetId } from '@/shared/app/themes'
import type { AppSettingsPatch } from '@/server/settings'

const MAX_MODEL_ID_LENGTH = 160
const MAX_ASK_MODEL_IDS = 4
const MAX_ENABLED_MODEL_IDS = 400
const MODEL_ID_PATTERN = /^[A-Za-z0-9._~:/@+-]+$/
const ASPECT_RATIO_PATTERN = /^\d{1,2}:\d{1,2}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSafeModelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_MODEL_ID_LENGTH &&
    MODEL_ID_PATTERN.test(value)
  )
}

function isSafeAspectRatio(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 5 && ASPECT_RATIO_PATTERN.test(value)
}

function publicSettingsPayload(settings: AppSettings & { useSecondarySidebar?: boolean }) {
  const publicSettings = { ...settings }
  delete publicSettings.useSecondarySidebar
  return { ...publicSettings, chatStreamingMode: 'token' as const }
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    if (context.appDataCapabilities.provider === 'postgres') {
      const settings = await getOverlayServerContext()
        .appData
        .repositories
        .settings
        .getByUserId(auth.userId)
      return NextResponse.json(publicSettingsPayload(settings))
    }

    const settings = await convex.query<AppSettings>(
      'platform/uiSettings:getByServer',
      {
        userId: auth.userId,
        serverSecret: getInternalApiSecret(),
      },
      { throwOnError: true },
    )
    if (!settings) throw new Error('Missing UI settings')
    return NextResponse.json(publicSettingsPayload(settings))
  } catch (error) {
    logger.error('[app/settings] GET error:', error)
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const rawBody = await request.json().catch((_error) => null)
    if (!isPlainObject(rawBody)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const body = rawBody as {
      theme?: 'light' | 'dark'
      lightThemePreset?: ThemePresetId
      darkThemePreset?: ThemePresetId
      autoContinue?: boolean
      defaultChatMode?: ChatModePreference
      modelPreference?: AppSettings['modelPreference']
      defaultAskModelIds?: string[]
      defaultActModelId?: string
      defaultImageModelId?: string
      defaultVideoModelId?: string
      defaultImageAspectRatio?: string
      defaultVideoAspectRatio?: string
      sendWithEnter?: boolean
      attachFilesToKnowledgeByDefault?: boolean
      onlyAllowZdrModels?: boolean
      dismissedZdrWarningGlobally?: boolean
      dismissedZdrWarningModelIds?: string[]
      enabledChatModelIds?: string[]
      modelOrder?: string[]
      /** @deprecated Only `token` is supported; `chunk` is accepted for compatibility and normalized away. */
      chatStreamingMode?: 'token' | 'chunk'
      accessToken?: string
      userId?: string
    }

    if (body.theme !== undefined && body.theme !== 'light' && body.theme !== 'dark') {
      return NextResponse.json({ error: 'Invalid theme' }, { status: 400 })
    }
    if (body.lightThemePreset !== undefined && !isThemePresetId(body.lightThemePreset)) {
      return NextResponse.json({ error: 'Invalid lightThemePreset' }, { status: 400 })
    }
    if (body.darkThemePreset !== undefined && !isThemePresetId(body.darkThemePreset)) {
      return NextResponse.json({ error: 'Invalid darkThemePreset' }, { status: 400 })
    }
    if (body.autoContinue !== undefined && typeof body.autoContinue !== 'boolean') {
      return NextResponse.json({ error: 'Invalid autoContinue' }, { status: 400 })
    }
    if (
      body.defaultChatMode !== undefined &&
      body.defaultChatMode !== 'ask' &&
      body.defaultChatMode !== 'act'
    ) {
      return NextResponse.json({ error: 'Invalid defaultChatMode' }, { status: 400 })
    }
    if (
      body.modelPreference !== undefined &&
      body.modelPreference !== 'same-for-each-chat' &&
      body.modelPreference !== 'different-for-each-chat'
    ) {
      return NextResponse.json({ error: 'Invalid modelPreference' }, { status: 400 })
    }
    if (
      body.defaultAskModelIds !== undefined &&
      (!Array.isArray(body.defaultAskModelIds) ||
        body.defaultAskModelIds.length > MAX_ASK_MODEL_IDS ||
        !body.defaultAskModelIds.every(isSafeModelId))
    ) {
      return NextResponse.json({ error: 'Invalid defaultAskModelIds' }, { status: 400 })
    }
    for (const key of [
      'defaultActModelId',
      'defaultImageModelId',
      'defaultVideoModelId',
    ] as const) {
      if (body[key] !== undefined && !isSafeModelId(body[key])) {
        return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
      }
    }
    for (const key of ['defaultImageAspectRatio', 'defaultVideoAspectRatio'] as const) {
      if (body[key] !== undefined && !isSafeAspectRatio(body[key])) {
        return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
      }
    }
    if (body.sendWithEnter !== undefined && typeof body.sendWithEnter !== 'boolean') {
      return NextResponse.json({ error: 'Invalid sendWithEnter' }, { status: 400 })
    }
    if (
      body.attachFilesToKnowledgeByDefault !== undefined &&
      typeof body.attachFilesToKnowledgeByDefault !== 'boolean'
    ) {
      return NextResponse.json({ error: 'Invalid attachFilesToKnowledgeByDefault' }, { status: 400 })
    }
    if (body.onlyAllowZdrModels !== undefined && typeof body.onlyAllowZdrModels !== 'boolean') {
      return NextResponse.json({ error: 'Invalid onlyAllowZdrModels' }, { status: 400 })
    }
    if (
      body.dismissedZdrWarningGlobally !== undefined &&
      typeof body.dismissedZdrWarningGlobally !== 'boolean'
    ) {
      return NextResponse.json({ error: 'Invalid dismissedZdrWarningGlobally' }, { status: 400 })
    }
    if (
      body.dismissedZdrWarningModelIds !== undefined &&
      (!Array.isArray(body.dismissedZdrWarningModelIds) ||
        body.dismissedZdrWarningModelIds.length > 100 ||
        !body.dismissedZdrWarningModelIds.every(isSafeModelId))
    ) {
      return NextResponse.json({ error: 'Invalid dismissedZdrWarningModelIds' }, { status: 400 })
    }
    if (
      body.enabledChatModelIds !== undefined &&
      (!Array.isArray(body.enabledChatModelIds) ||
        body.enabledChatModelIds.length > MAX_ENABLED_MODEL_IDS ||
        !body.enabledChatModelIds.every(isSafeModelId))
    ) {
      return NextResponse.json({ error: 'Invalid enabledChatModelIds' }, { status: 400 })
    }
    if (
      body.modelOrder !== undefined &&
      (!Array.isArray(body.modelOrder) ||
        body.modelOrder.length > MAX_ENABLED_MODEL_IDS ||
        !body.modelOrder.every(isSafeModelId))
    ) {
      return NextResponse.json({ error: 'Invalid modelOrder' }, { status: 400 })
    }
    if (
      body.chatStreamingMode !== undefined &&
      body.chatStreamingMode !== 'token' &&
      body.chatStreamingMode !== 'chunk'
    ) {
      return NextResponse.json({ error: 'Invalid chatStreamingMode' }, { status: 400 })
    }

    const { auth } = context

    const settingsPatch: AppSettingsPatch = {}
    const mutationArgs: {
      userId: string
      serverSecret: string
      theme?: 'light' | 'dark'
      lightThemePreset?: string
      darkThemePreset?: string
      autoContinue?: boolean
      defaultChatMode?: ChatModePreference
      modelPreference?: AppSettings['modelPreference']
      defaultAskModelIds?: string[]
      defaultActModelId?: string
      defaultImageModelId?: string
      defaultVideoModelId?: string
      defaultImageAspectRatio?: string
      defaultVideoAspectRatio?: string
      sendWithEnter?: boolean
      attachFilesToKnowledgeByDefault?: boolean
      onlyAllowZdrModels?: boolean
      dismissedZdrWarningGlobally?: boolean
      dismissedZdrWarningModelIds?: string[]
      enabledChatModelIds?: string[]
      modelOrder?: string[]
    } = {
      userId: auth.userId,
      serverSecret: getInternalApiSecret(),
    }

    if (body.theme !== undefined) {
      mutationArgs.theme = body.theme
      settingsPatch.theme = body.theme
    }
    if (body.lightThemePreset !== undefined) {
      mutationArgs.lightThemePreset = body.lightThemePreset
      settingsPatch.lightThemePreset = body.lightThemePreset
    }
    if (body.darkThemePreset !== undefined) {
      mutationArgs.darkThemePreset = body.darkThemePreset
      settingsPatch.darkThemePreset = body.darkThemePreset
    }
    if (body.autoContinue !== undefined) {
      mutationArgs.autoContinue = body.autoContinue
      settingsPatch.autoContinue = body.autoContinue
    }
    if (body.defaultChatMode !== undefined) {
      mutationArgs.defaultChatMode = body.defaultChatMode
      settingsPatch.defaultChatMode = body.defaultChatMode
    }
    if (body.modelPreference !== undefined) {
      mutationArgs.modelPreference = body.modelPreference
      settingsPatch.modelPreference = body.modelPreference
    }
    if (body.defaultAskModelIds !== undefined) {
      mutationArgs.defaultAskModelIds = body.defaultAskModelIds.map((id) => id.trim())
      settingsPatch.defaultAskModelIds = mutationArgs.defaultAskModelIds
    }
    if (body.defaultActModelId !== undefined) {
      mutationArgs.defaultActModelId = body.defaultActModelId.trim()
      settingsPatch.defaultActModelId = mutationArgs.defaultActModelId
    }
    if (body.defaultImageModelId !== undefined) {
      mutationArgs.defaultImageModelId = body.defaultImageModelId.trim()
      settingsPatch.defaultImageModelId = mutationArgs.defaultImageModelId
    }
    if (body.defaultVideoModelId !== undefined) {
      mutationArgs.defaultVideoModelId = body.defaultVideoModelId.trim()
      settingsPatch.defaultVideoModelId = mutationArgs.defaultVideoModelId
    }
    if (body.defaultImageAspectRatio !== undefined) {
      mutationArgs.defaultImageAspectRatio = body.defaultImageAspectRatio.trim()
      settingsPatch.defaultImageAspectRatio = mutationArgs.defaultImageAspectRatio
    }
    if (body.defaultVideoAspectRatio !== undefined) {
      mutationArgs.defaultVideoAspectRatio = body.defaultVideoAspectRatio.trim()
      settingsPatch.defaultVideoAspectRatio = mutationArgs.defaultVideoAspectRatio
    }
    if (body.sendWithEnter !== undefined) {
      mutationArgs.sendWithEnter = body.sendWithEnter
      settingsPatch.sendWithEnter = body.sendWithEnter
    }
    if (body.attachFilesToKnowledgeByDefault !== undefined) {
      mutationArgs.attachFilesToKnowledgeByDefault = body.attachFilesToKnowledgeByDefault
      settingsPatch.attachFilesToKnowledgeByDefault = body.attachFilesToKnowledgeByDefault
    }
    if (body.onlyAllowZdrModels !== undefined) {
      mutationArgs.onlyAllowZdrModels = body.onlyAllowZdrModels
      settingsPatch.onlyAllowZdrModels = body.onlyAllowZdrModels
    }
    if (body.dismissedZdrWarningGlobally !== undefined) {
      mutationArgs.dismissedZdrWarningGlobally = body.dismissedZdrWarningGlobally
      settingsPatch.dismissedZdrWarningGlobally = body.dismissedZdrWarningGlobally
    }
    if (body.dismissedZdrWarningModelIds !== undefined) {
      mutationArgs.dismissedZdrWarningModelIds = Array.from(new Set(body.dismissedZdrWarningModelIds.map((id) => id.trim()))).slice(0, 100)
      settingsPatch.dismissedZdrWarningModelIds = mutationArgs.dismissedZdrWarningModelIds
    }
    if (body.enabledChatModelIds !== undefined) {
      mutationArgs.enabledChatModelIds = Array.from(new Set(body.enabledChatModelIds.map((id) => id.trim()))).slice(0, MAX_ENABLED_MODEL_IDS)
      settingsPatch.enabledChatModelIds = mutationArgs.enabledChatModelIds
    }
    if (body.modelOrder !== undefined) {
      mutationArgs.modelOrder = Array.from(new Set(body.modelOrder.map((id) => id.trim()))).slice(0, MAX_ENABLED_MODEL_IDS)
      settingsPatch.modelOrder = mutationArgs.modelOrder
    }
    if (body.chatStreamingMode !== undefined) {
      settingsPatch.chatStreamingMode = 'token'
    }

    if (context.appDataCapabilities.provider === 'postgres') {
      const settings = await getOverlayServerContext()
        .appData
        .repositories
        .settings
        .updateForUserId(auth.userId, settingsPatch)
      return NextResponse.json(publicSettingsPayload(settings))
    }

    const settings = await convex.mutation<AppSettings>(
      'platform/uiSettings:upsertByServer',
      mutationArgs,
      { throwOnError: true },
    )
    if (!settings) throw new Error('Missing saved UI settings')
    return NextResponse.json(publicSettingsPayload(settings))
  } catch (error) {
    logger.error('[app/settings] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
