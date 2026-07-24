export async function migrateToAgentMemorySchema(): Promise<{
  migrated: number
  failed: number
  skipped: boolean
}> {
  return { migrated: 0, failed: 0, skipped: true }
}

export async function needsMigration(): Promise<boolean> {
  return false
}
