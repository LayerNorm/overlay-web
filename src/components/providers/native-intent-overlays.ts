export function settleIntents<T extends { id: string; settled?: boolean }>(rows: T[], id: string, committed: boolean): T[] {
  const next = committed ? rows.map(row => row.id === id ? { ...row, settled: true } : row) : rows.filter(row => row.id !== id)
  const firstPending = next.findIndex(row => !row.settled)
  return firstPending < 0 ? [] : next.slice(firstPending)
}
