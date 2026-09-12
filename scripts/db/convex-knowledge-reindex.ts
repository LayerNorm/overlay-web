import { callConvex, getInternalApiSecret, loadLocalEnv, readArg, resolveTargets } from '../lib/convex-admin-utils.ts'

type ReindexResult = {
  totalCanonicalFiles: number
  reindexed: number
}

async function main() {
  loadLocalEnv()
  const secret = getInternalApiSecret()
  const envArg = readArg('env', 'both')
  const targets = resolveTargets(envArg)
  const limitArg = readArg('limit')
  const limit = limitArg ? Number(limitArg) : undefined

  for (const target of targets) {
    const result = await callConvex<ReindexResult>(
      target,
      'action',
      'files/storageAdmin:reindexAllCanonicalFilesByServer',
      {
        serverSecret: secret,
        ...(Number.isFinite(limit) ? { limit } : {}),
      },
    )
    console.log(`\n[${target.toUpperCase()}]`)
    console.log(JSON.stringify(result, null, 2))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
