export interface PersonalChatRow {
  _id: string
}

export interface PersonalChatArchiveRow extends PersonalChatRow {
  archivedAt?: number
}

export interface PersonalChatUnreadRow extends PersonalChatRow {
  unread: boolean
  lastMessageId?: string
}

export type PersonalChatArchiveArgs = {
  workspaceId: string
  conversationId: string
  archived: boolean
}

export function createPersonalChatArchiveOptimisticUpdate<Row extends PersonalChatArchiveRow>(
  fallback: Row,
  effects: {
    getCurrent(args: PersonalChatArchiveArgs): Row | null | undefined
    move(args: PersonalChatArchiveArgs, row: Row | null): void
    updateSelected(args: PersonalChatArchiveArgs, archivedAt: number | undefined): void
  },
): (args: PersonalChatArchiveArgs) => void {
  return (args) => {
    const archivedAt = args.archived ? Date.now() : undefined
    const current = effects.getCurrent(args)
    effects.move(args, archivePersonalChatRow(current, fallback, archivedAt))
    effects.updateSelected(args, archivedAt)
  }
}

export function archivePersonalChatRow<Row extends PersonalChatRow>(
  current: Row | null | undefined,
  fallback: Row | undefined,
  archivedAt: number | undefined,
): Row | null {
  // A resolved missing summary is a tombstone, not an unloaded query.
  if (current === null) return null
  const row = current ?? fallback
  return row ? { ...row, archivedAt } : null
}

export function updatePersonalChatUnread<Row extends PersonalChatUnreadRow>(
  row: Row,
  unread: boolean,
  throughMessageId?: string,
): Row {
  if (!unread && (!throughMessageId || throughMessageId !== row.lastMessageId)) return row
  return { ...row, unread }
}

export function updatePersonalChatRow<Row extends PersonalChatRow>(
  rows: readonly Row[],
  conversationId: string,
  update: (row: Row) => Row,
): Row[] {
  return rows.map((row) => (row._id === conversationId ? update(row) : row))
}

export function removePersonalChatRow<Row extends PersonalChatRow>(
  rows: readonly Row[],
  conversationId: string,
): Row[] {
  return rows.filter((row) => row._id !== conversationId)
}

export function insertPersonalChatRow<Row extends PersonalChatRow>(
  rows: readonly Row[],
  row: Row,
): Row[] {
  return [row, ...rows.filter((existing) => existing._id !== row._id)]
}
