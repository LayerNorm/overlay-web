type Thread = { conversationId: string; title: string; archivedAt?: number | null }

export async function resolveAgentEntryThread<T extends Thread>({ list, fallback }: {
  list: () => Promise<T[]>
  fallback: () => Promise<Thread>
}): Promise<Thread> {
  // The bundle uses the same newest-first order as the visible sidebar rows.
  return (await list()).find(thread => !thread.archivedAt) ?? await fallback()
}
