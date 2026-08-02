/**
 * Per-conversation composer drafts.
 *
 * Private browsing and hardened mobile browsers throw on localStorage access,
 * so every operation here is best-effort: a storage failure loses the draft and
 * never propagates into the shell.
 */

const PREFIX = 'overlay.draft.v1'
const MAX_DRAFT_LENGTH = 20_000

export type DraftScope = {
  workspaceId?: string | null
  conversationId: string
  threadRootMessageId?: string | null
}

export function draftKey(scope: DraftScope): string {
  return [
    PREFIX,
    scope.workspaceId ?? 'personal',
    scope.conversationId,
    scope.threadRootMessageId ?? 'root',
  ].join(':')
}

export function readDraft(scope: DraftScope): string {
  const storage = safeStorage()
  if (!storage) return ''
  try {
    return storage.getItem(draftKey(scope)) ?? ''
  } catch {
    return ''
  }
}

export function writeDraft(scope: DraftScope, value: string): void {
  const storage = safeStorage()
  if (!storage) return
  const key = draftKey(scope)
  try {
    if (!value.trim()) storage.removeItem(key)
    else storage.setItem(key, value.slice(0, MAX_DRAFT_LENGTH))
  } catch {
    // Quota exceeded or storage disabled: the draft is simply not persisted.
  }
}

export function clearDraft(scope: DraftScope): void {
  writeDraft(scope, '')
}

/** Drops every draft for a workspace, used when membership is revoked. */
export function clearWorkspaceDrafts(workspaceId: string): void {
  const storage = safeStorage()
  if (!storage) return
  try {
    const prefix = `${PREFIX}:${workspaceId}:`
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    // Accessing localStorage itself throws in some privacy modes.
    return null
  }
}
