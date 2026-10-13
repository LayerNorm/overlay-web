export const WORK_VIEWS = ['list', 'board', 'timeline'] as const
export type WorkLayout = (typeof WORK_VIEWS)[number]
export function resolveWorkView(value: string | null | undefined): WorkLayout {
  return value === 'board' || value === 'timeline' ? value : 'list'
}
