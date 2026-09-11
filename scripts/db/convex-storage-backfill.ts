import { callConvex, getInternalApiSecret, loadLocalEnv, readArg, resolveTargets } from '../lib/convex-admin-utils.ts'

type BackfillResult = {
  filesInspected: number
  outputsInspected: number
  subscriptionsInspected: number
  filePatchesApplied: number
  outputPatchesApplied: number
  duplicateKnowledgePurged: number
  subscriptionsUpdated: number
  measurementFailures: Array<{ kind: 'file' | 'output'; id: string; error: string }>
}

async function main() {
  loadLocalEnv()
  const secret = getInternalApiSecret()
  const envArg = readArg('env', 'both')
  const targets = resolveTargets(envArg)

  for (const target of targets) {
    const result = await callConvex<BackfillResult>(
      target,
      'action',
      'files/storageAdmin:backfillStorageUsageByServer',
      { serverSecret: secret },
    )
    console.log(`\n[${target.toUpperCase()}]`)
    console.log(JSON.stringify(result, null, 2))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
