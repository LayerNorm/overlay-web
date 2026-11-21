import { useSyncExternalStore } from 'react'
import { splitHref, useHref } from '../../shims/router'

/** The Atlas thread that runs and stays on this computer. */
export const PRIVATE_THREAD_ID = 'k17convatlasprivatestripe'.padEnd(32, '0')

// Which threads are not synced. In the product this is chosen before the first message and fixed after it.
const notSynced = new Set<string>([PRIVATE_THREAD_ID])
const listeners = new Set<() => void>()
let version = 0

function notify() {
  version += 1
  for (const listener of listeners) listener()
}

export function setSynced(conversationId: string, synced: boolean) {
  if (synced) notSynced.delete(conversationId)
  else notSynced.add(conversationId)
  notify()
}

export function useNotSynced(conversationId: string | null): boolean {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => version)
  return conversationId ? notSynced.has(conversationId) : false
}

/** The open thread, from the app's address. */
export function useConversationId(): string | null {
  const { search } = splitHref(useHref())
  return new URLSearchParams(search).get('id')
}
