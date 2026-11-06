export type NativeFileQuerySnapshot<T> = {
  canQuery: boolean
  status: 'success' | 'pending' | 'error'
  data?: { nodes: readonly T[] }
}

export function projectNativeFileSidebarRows<T>(snapshot: NativeFileQuerySnapshot<T>): T[] {
  if (!snapshot.canQuery || snapshot.status !== 'success' || !snapshot.data) return []
  return [...snapshot.data.nodes]
}
