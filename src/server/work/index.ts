import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { WorkService } from './WorkService'
import type { WorkRepository } from './WorkRepository'

export { ConvexWorkRepository, mapWorkEventDoc, mapWorkItemDoc } from './ConvexWorkRepository'
export type { WorkRepository } from './WorkRepository'
export { WorkService, WorkServiceError, translateWorkError } from './WorkService'
export * from './work-input'

let service: WorkService | undefined

/** The app's WorkService, built once over the configured repository. */
export function getWorkService(): WorkService {
  service ??= new WorkService(repositoryProxy<WorkRepository>(() => getOverlayServerContext().appData.repositories.work))
  return service
}
