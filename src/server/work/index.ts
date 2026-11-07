import 'server-only'

import { ConvexWorkRepository } from './ConvexWorkRepository'
import { WorkService } from './WorkService'

export { ConvexWorkRepository, mapWorkEventDoc, mapWorkItemDoc } from './ConvexWorkRepository'
export type { WorkRepository } from './WorkRepository'
export { WorkService, WorkServiceError, translateWorkError } from './WorkService'
export * from './work-input'

let service: WorkService | undefined

/** The app's WorkService, built once over the configured repository. */
export function getWorkService(): WorkService {
  service ??= new WorkService(new ConvexWorkRepository())
  return service
}
