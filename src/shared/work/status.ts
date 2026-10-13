export const WORK_STATUSES = ['backlog', 'todo', 'progress', 'review', 'done'] as const
export type WorkStatus = (typeof WORK_STATUSES)[number]
export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  backlog: 'Backlog', todo: 'To do', progress: 'In progress', review: 'In review', done: 'Done',
}
export const WORK_UPDATED_EVENT = 'overlay:work-updated'
