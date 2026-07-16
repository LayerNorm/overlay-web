import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import { FileService } from '@/server/files/FileService'
import type { FileRepository } from '@/server/files/FileRepository'
import { OutputService } from './OutputService'

const repository = repositoryProxy<FileRepository>(
  () => getOverlayServerContext().appData.repositories.files,
)

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
