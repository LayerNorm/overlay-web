import 'server-only'

import { ConvexFileRepository } from '@/server/files/ConvexFileRepository'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import { FileService } from '@/server/files/FileService'
import { OutputService } from './OutputService'

const repository = new ConvexFileRepository()

const files = new FileService({ repository })

export const outputService = new OutputService({
  files,
  repository,
  retentionPolicy: () => {
    const retention = getOverlayRuntimeConfigSync().compliance.retention
    return {
      generatedDays: retention.fileDays,
      sandboxDays: retention.sandboxArtifactDays,
    }
  },
})

export { type OutputRecord, type OutputSource, type OutputStatus } from './OutputService'
