import type {
  AppSettings,
  KnowledgeFile,
  MemoryRow,
  NoteDoc,
  OutputSummary,
  ProjectSummary,
  SettingsSubview,
} from './contracts'
export { filterExtensionCatalog, type ExtensionCatalogItem } from './extensions'

export type FeatureModuleId =
  | 'files-knowledge'
  | 'notes'
  | 'projects'
  | 'tools-extensions'
  | 'settings-account'

export {
  accountPlanLabel,
  accountStatusDescription,
  buildSettingsRegistrySummary,
  formatAccountDate,
  formatAccountDateTime,
  formatCents,
  normalizeTopUpDraft,
  remainingUsagePercentage,
  resolveSettingsPanel,
  settingsPanelsForSection,
  usageProgressTone,
} from './settings-account'

export interface TreeNode<T extends { _id: string; parentId?: string | null }> {
  item: T
  children: TreeNode<T>[]
  depth: number
}

export function sortByName<T extends { name?: string; title?: string; updatedAt?: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const aName = (a.name ?? a.title ?? '').toLowerCase()
    const bName = (b.name ?? b.title ?? '').toLowerCase()
    if (aName !== bName) return aName.localeCompare(bName)
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  })
}

export function buildTree<T extends { _id: string; parentId?: string | null; name?: string; title?: string; updatedAt?: number }>(
  items: readonly T[],
  parentId: string | null = null,
  depth = 0,
): TreeNode<T>[] {
  return sortByName(items.filter((item) => (item.parentId ?? null) === parentId)).map((item) => ({
    item,
    depth,
    children: buildTree(items, item._id, depth + 1),
  }))
}

export function flattenTree<T extends { _id: string; parentId?: string | null }>(
  nodes: readonly TreeNode<T>[],
): Array<TreeNode<T>> {
  const out: Array<TreeNode<T>> = []
  for (const node of nodes) {
    out.push(node)
    out.push(...flattenTree(node.children))
  }
  return out
}

export function filterKnowledgeFiles(
  files: readonly KnowledgeFile[],
  options: { query?: string; projectId?: string | null; kind?: KnowledgeFile['kind'] | KnowledgeFile['type'] } = {},
): KnowledgeFile[] {
  const q = options.query?.trim().toLowerCase()
  return files.filter((file) => {
    if (options.projectId !== undefined && (file.projectId ?? null) !== options.projectId) return false
    if (options.kind && file.kind !== options.kind && file.type !== options.kind) return false
    if (!q) return true
    return file.name.toLowerCase().includes(q) || file.content?.toLowerCase().includes(q)
  })
}

export function groupOutputsByStatus(outputs: readonly OutputSummary[]) {
  return outputs.reduce(
    (acc, output) => {
      acc[output.status].push(output)
      return acc
    },
    {
      pending: [] as OutputSummary[],
      completed: [] as OutputSummary[],
      failed: [] as OutputSummary[],
    },
  )
}

export function sortNotes(notes: readonly NoteDoc[]): NoteDoc[] {
  return [...notes].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export function noteEditorState(input: {
  note: Pick<NoteDoc, 'title' | 'content'> | null
  draftTitle: string
  draftContent: string
  saving?: boolean
}) {
  const normalizedTitle = input.draftTitle.trim() || 'Untitled'
  const originalTitle = input.note?.title ?? ''
  const originalContent = input.note?.content ?? ''
  const isDirty = normalizedTitle !== originalTitle || input.draftContent !== originalContent
  return {
    title: normalizedTitle,
    isDirty,
    canSave: Boolean(input.note) && isDirty && !input.saving,
  }
}

export function buildProjectTree(projects: readonly ProjectSummary[]): TreeNode<ProjectSummary>[] {
  return buildTree(projects)
}

export function collectProjectDescendantIds(
  projects: readonly Pick<ProjectSummary, '_id' | 'parentId'>[],
  projectId: string,
): string[] {
  const children = projects.filter((project) => project.parentId === projectId)
  return children.flatMap((child) => [child._id, ...collectProjectDescendantIds(projects, child._id)])
}

export function resolveSettingsSection(
  section: string | null | undefined,
  available: readonly { id: SettingsSubview | (string & {}) }[],
): string {
  const fallback = available[0]?.id ?? 'general'
  if (!section) return fallback
  return available.some((item) => item.id === section) ? section : fallback
}

export function applySettingsPatch(settings: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return {
    ...settings,
    ...patch,
    defaultAskModelIds: patch.defaultAskModelIds
      ? [...patch.defaultAskModelIds]
      : [...settings.defaultAskModelIds],
    dismissedZdrWarningModelIds: patch.dismissedZdrWarningModelIds
      ? [...patch.dismissedZdrWarningModelIds]
      : [...settings.dismissedZdrWarningModelIds],
  }
}

export function filterMemories(
  memories: readonly MemoryRow[],
  options: { query?: string; status?: MemoryRow['status']; projectId?: string } = {},
): MemoryRow[] {
  const q = options.query?.trim().toLowerCase()
  return memories.filter((memory) => {
    if (options.status && memory.status !== options.status) return false
    if (options.projectId && memory.projectId !== options.projectId) return false
    if (!q) return true
    return [memory.content, memory.fullContent, memory.source, ...(memory.tags ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
}
