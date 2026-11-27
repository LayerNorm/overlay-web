import { anyApi } from 'convex/server'
import type { api as webApi } from '../../../convex/_generated/api'

export type { Id } from '../../../convex/_generated/dataModel'

export const api = anyApi as unknown as typeof webApi
