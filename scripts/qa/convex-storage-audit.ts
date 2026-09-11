import { callConvex, getInternalApiSecret, loadLocalEnv, readArg, resolveTargets, type DeploymentTarget } from '../lib/convex-admin-utils.ts'

type AuditResult = {
  totalTables: number
  nonEmptyTablesCount: number
  nonEmptyTables: string[]
  tableCounts: Record<string, number>
  totals: {
    inlineFileBytes: number
    outputBytes: number
    knowledgeChunks: number
    knowledgeChunkEmbeddings: number
  }
  topStorageUsers: Array<{
    userId: string
    fileBytes: number
    outputBytes: number
    totalBytes: number
    fileCount: number
    outputCount: number
  }>
  topChunkFiles: Array<{
    fileId: string
    chunkCount: number
    fileName: string | null
    userId: string | null
    duplicateOfFileId: string | null
  }>
  duplicateHashes: Array<{
    userId: string
    contentHash: string
    count: number
    fileIds: string[]
    names: string[]
  }>
}

function printSection(target: DeploymentTarget, result: AuditResult) {
  console.log(`\n[${target.toUpperCase()}]`)
  console.log(JSON.stringify({
    tables: {
      total: result.totalTables,
      nonEmpty: result.nonEmptyTablesCount,
      counts: result.tableCounts,
    },
    totals: result.totals,
    topStorageUsers: result.topStorageUsers,
    topChunkFiles: result.topChunkFiles,
    duplicateHashes: result.duplicateHashes,
  }, null, 2))
}

async function main() {
  loadLocalEnv()
  const secret = getInternalApiSecret()
  const envArg = readArg('env', 'both')
  const targets = resolveTargets(envArg)

  for (const target of targets) {
    const result = await callConvex<AuditResult>(
      target,
      'query',
      'files/storageAdmin:auditByServer',
      { serverSecret: secret },
    )
    printSection(target, result)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
