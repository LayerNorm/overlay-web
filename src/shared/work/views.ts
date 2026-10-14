/** The three ways to look at the same tasks. The choice lives in the URL (`?view=`), so a link opens where it was made. */
export const WORK_VIEWS = ['list', 'board', 'timeline'] as const
export type WorkView = (typeof WORK_VIEWS)[number]

export const DEFAULT_WORK_VIEW: WorkView = 'list'
export const WORK_VIEW_PARAM = 'view'

export const WORK_VIEW_LABELS: Record<WorkView, string> = {
  list: 'List',
  board: 'Board',
  timeline: 'Timeline',
}

export function parseWorkView(value: unknown): WorkView | null {
  return typeof value === 'string' && (WORK_VIEWS as readonly string[]).includes(value) ? (value as WorkView) : null
}

export function resolveWorkView(value: unknown): WorkView {
  return parseWorkView(value) ?? DEFAULT_WORK_VIEW
}
