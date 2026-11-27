import {
  DEFAULT_MODEL_ID,
  type ActiveRunState,
  type ApprovalRequest,
  type ControlIndicatorState,
  type EntitlementsSnapshot,
  type ExtensionPreferences,
  type ExtensionSession,
  type StoredConversation,
  type ToolHistoryEntry,
} from '@overlay/extension-contracts'

const STORAGE_KEYS = {
  session: 'overlay.session',
  conversations: 'overlay.conversations',
  activeConversationId: 'overlay.activeConversationId',
  approvals: 'overlay.approvals',
  toolHistory: 'overlay.toolHistory',
  preferences: 'overlay.preferences',
  /** @deprecated migrated into activeRuns */
  activeRun: 'overlay.activeRun',
  activeRuns: 'overlay.activeRuns',
  conversationTabGroups: 'overlay.conversationTabGroups',
  controlIndicator: 'overlay.controlIndicator',
  entitlements: 'overlay.entitlements',
} as const

interface StorageShape {
  [STORAGE_KEYS.session]?: ExtensionSession
  [STORAGE_KEYS.conversations]?: unknown[]
  [STORAGE_KEYS.activeConversationId]?: string
  [STORAGE_KEYS.approvals]?: ApprovalRequest[]
  [STORAGE_KEYS.toolHistory]?: ToolHistoryEntry[]
  [STORAGE_KEYS.preferences]?: ExtensionPreferences
  [STORAGE_KEYS.activeRun]?: ActiveRunState
  [STORAGE_KEYS.activeRuns]?: Record<string, ActiveRunState>
  [STORAGE_KEYS.conversationTabGroups]?: Record<string, number>
  [STORAGE_KEYS.controlIndicator]?: ControlIndicatorState
  [STORAGE_KEYS.entitlements]?: EntitlementsSnapshot
}

function isRecordOfRuns(value: unknown): value is Record<string, ActiveRunState> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Fold legacy `actModelId` / `askModelId` into `modelId` (extension single-model UX). */
export function normalizeExtensionPreferencesModelFields(
  preferences: ExtensionPreferences & { askModelId?: string },
): ExtensionPreferences {
  const { actModelId, askModelId, ...rest } = preferences
  const modelId =
    preferences.modelId?.trim() ||
    askModelId?.trim() ||
    actModelId?.trim() ||
    DEFAULT_MODEL_ID
  return { ...rest, modelId }
}

async function migratePreferencesLegacyChatModelsIfNeeded(): Promise<void> {
  const raw = (await chrome.storage.local.get(STORAGE_KEYS.preferences)) as StorageShape
  const prefs = raw[STORAGE_KEYS.preferences]
  if (!prefs || typeof prefs !== 'object') return
  const p = prefs as ExtensionPreferences & { actModelId?: string; askModelId?: string }
  if (!p.actModelId?.trim() && !p.askModelId?.trim()) return

  const next = normalizeExtensionPreferencesModelFields(p)
  await chrome.storage.local.set({ [STORAGE_KEYS.preferences]: next })
}

/** Merge legacy singleton activeRun into activeRuns map. */
export async function migrateLegacyActiveRunIfNeeded(): Promise<void> {
  const raw = (await chrome.storage.local.get([
    STORAGE_KEYS.activeRuns,
    STORAGE_KEYS.activeRun,
  ])) as StorageShape

  let map = isRecordOfRuns(raw[STORAGE_KEYS.activeRuns]) ? { ...raw[STORAGE_KEYS.activeRuns] } : {}
  const legacy = raw[STORAGE_KEYS.activeRun]
  if (legacy && typeof legacy.conversationId === 'string' && !map[legacy.conversationId]) {
    map = { ...map, [legacy.conversationId]: legacy }
  }

  if (legacy || Object.keys(map).length > 0) {
    await chrome.storage.local.set({ [STORAGE_KEYS.activeRuns]: map })
    if (legacy) {
      await chrome.storage.local.remove(STORAGE_KEYS.activeRun)
    }
  }
}

export async function getExtensionStorage(): Promise<{
  session: ExtensionSession | null
  conversations: unknown[]
  activeConversationId: string | null
  approvals: ApprovalRequest[]
  toolHistory: ToolHistoryEntry[]
  preferences: ExtensionPreferences | null
  activeRuns: Record<string, ActiveRunState>
  conversationTabGroups: Record<string, number>
  controlIndicator: ControlIndicatorState | null
  entitlements: EntitlementsSnapshot | null
}> {
  await migrateLegacyActiveRunIfNeeded()
  await migratePreferencesLegacyChatModelsIfNeeded()

  const values = (await chrome.storage.local.get([
    STORAGE_KEYS.session,
    STORAGE_KEYS.conversations,
    STORAGE_KEYS.activeConversationId,
    STORAGE_KEYS.approvals,
    STORAGE_KEYS.toolHistory,
    STORAGE_KEYS.preferences,
    STORAGE_KEYS.activeRuns,
    STORAGE_KEYS.conversationTabGroups,
    STORAGE_KEYS.controlIndicator,
    STORAGE_KEYS.entitlements,
  ])) as StorageShape

  const activeRunsRaw = values[STORAGE_KEYS.activeRuns]
  const activeRuns = isRecordOfRuns(activeRunsRaw) ? activeRunsRaw : {}

  const groupsRaw = values[STORAGE_KEYS.conversationTabGroups]
  const conversationTabGroups =
    groupsRaw !== null && typeof groupsRaw === 'object' && !Array.isArray(groupsRaw)
      ? (groupsRaw as Record<string, number>)
      : {}

  return {
    session: values[STORAGE_KEYS.session] ?? null,
    conversations: values[STORAGE_KEYS.conversations] ?? [],
    activeConversationId: values[STORAGE_KEYS.activeConversationId] ?? null,
    approvals: values[STORAGE_KEYS.approvals] ?? [],
    toolHistory: values[STORAGE_KEYS.toolHistory] ?? [],
    preferences: values[STORAGE_KEYS.preferences] ?? null,
    activeRuns,
    conversationTabGroups,
    controlIndicator: values[STORAGE_KEYS.controlIndicator] ?? null,
    entitlements: values[STORAGE_KEYS.entitlements] ?? null,
  }
}

export async function setEntitlements(entitlements: EntitlementsSnapshot | null) {
  if (!entitlements) {
    await chrome.storage.local.remove(STORAGE_KEYS.entitlements)
    return
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.entitlements]: entitlements })
}

export async function setSession(session: ExtensionSession | null) {
  if (!session) {
    await chrome.storage.local.remove(STORAGE_KEYS.session)
    return
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session })
}

export async function setConversations(conversations: StoredConversation[]) {
  await chrome.storage.local.set({ [STORAGE_KEYS.conversations]: conversations })
}

export async function setApprovals(approvals: ApprovalRequest[]) {
  await chrome.storage.local.set({ [STORAGE_KEYS.approvals]: approvals })
}

export async function setToolHistory(toolHistory: ToolHistoryEntry[]) {
  await chrome.storage.local.set({ [STORAGE_KEYS.toolHistory]: toolHistory })
}

export async function setActiveConversationId(activeConversationId: string | null) {
  if (!activeConversationId) {
    await chrome.storage.local.remove(STORAGE_KEYS.activeConversationId)
    return
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.activeConversationId]: activeConversationId })
}

export async function setPreferences(preferences: ExtensionPreferences) {
  await chrome.storage.local.set({ [STORAGE_KEYS.preferences]: preferences })
}

export async function setActiveRunsMap(activeRuns: Record<string, ActiveRunState>) {
  if (Object.keys(activeRuns).length === 0) {
    await chrome.storage.local.remove(STORAGE_KEYS.activeRuns)
    return
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.activeRuns]: activeRuns })
}

export async function setConversationTabGroupsMap(map: Record<string, number>) {
  if (Object.keys(map).length === 0) {
    await chrome.storage.local.remove(STORAGE_KEYS.conversationTabGroups)
    return
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.conversationTabGroups]: map })
}

export async function setControlIndicator(controlIndicator: ControlIndicatorState | null) {
  if (!controlIndicator) {
    await chrome.storage.local.remove(STORAGE_KEYS.controlIndicator)
    return
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.controlIndicator]: controlIndicator })
}
