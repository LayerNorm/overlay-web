import { callConvex, getInternalApiSecret, loadLocalEnv, readArg, resolveTargets } from '../lib/convex-admin-utils.ts'

type BackfillResult = {
  dryRun: boolean
  userId?: string
  filesInspected: number
  filesPatched: number
  notesInspected: number
  notesMigrated: number
  outputsInspected: number
  outputsMigrated: number
  outputsLinked: number
  skipped: Array<{ kind: string; id: string; reason: string }>
}

function readBooleanArg(name: string, fallback: boolean): boolean {
  const value = readArg(name)
  if (value == null) return fallback
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'
}

async function main() {
  loadLocalEnv()
  const secret = getInternalApiSecret()
  const envArg = readArg('env', 'both')
  const dryRun = readBooleanArg('dry-run', true)
  const userId = readArg('user-id')
  const limitArg = readArg('limit')
  const limit = limitArg ? Number(limitArg) : undefined
  const targets = resolveTargets(envArg)

  for (const target of targets) {
    const result = await callConvex<BackfillResult>(
      target,
      'mutation',
      'files/files:backfillCanonicalFilesystem',
      {
        serverSecret: secret,
        dryRun,
        ...(userId ? { userId } : {}),
        ...(Number.isFinite(limit) ? { limit } : {}),
      },
    )
    console.log(`\n[${target.toUpperCase()}] canonical filesystem backfill${dryRun ? ' dry run' : ''}`)
    console.log(JSON.stringify(result, null, 2))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
