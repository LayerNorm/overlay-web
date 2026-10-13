import type { WorkStatus } from '@overlay/app-core/work'
export { WORK_STATUSES, type WorkStatus } from '@overlay/app-core/work'
export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  backlog: 'Backlog', todo: 'To do', progress: 'In progress', review: 'In review', done: 'Done',
}
export const WORK_UPDATED_EVENT = 'overlay:work-updated'
