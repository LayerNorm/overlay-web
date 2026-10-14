import type { ResourceView } from '@overlay/app-core'

export interface WorkQuery {
  /** Personal, workspace, or archived. Omitted means everything active the caller can see. */
  view?: ResourceView
}
