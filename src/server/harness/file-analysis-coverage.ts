import type { HarnessEvidence, HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { FileAnalysisPartition } from './file-analysis-policy'

export const FILE_ANALYSIS_MANIFEST = 'FILE_ANALYSIS_V1:'

export function fileAnalysisConstraints(partitions: FileAnalysisPartition[], group: string): string[] {
  const batches: FileAnalysisPartition[][] = [[]]
  for (const partition of partitions) {
    const batch = batches[batches.length - 1]
    if (JSON.stringify([...batch, partition]).length > 1600) batches.push([partition])
    else batch.push(partition)
  }
  return batches.map(partitions => `${FILE_ANALYSIS_MANIFEST}${JSON.stringify({ group, partitions })}`)
}

export function documentReadObservation(output: unknown) {
  if (!output || typeof output !== 'object') return undefined
  const envelope = output as Record<string, unknown>
  const value = (envelope.display ?? output) as Record<string, unknown>
  if (!value || typeof value !== 'object' || value.success !== true
    || typeof value.fileId !== 'string' || typeof value.revision !== 'string'
    || !Number.isSafeInteger(value.page) || Number(value.page) < 1
    || !['text', 'render', 'ocr'].includes(String(value.mode))
    || value.truncated === true || value.needsVisualInspection === true) return undefined
  return { fileId: value.fileId, revision: value.revision, page: Number(value.page), mode: String(value.mode) }
}

export function fileAnalysisAssignments(child: Pick<HarnessSnapshot, 'constraints'>): FileAnalysisPartition[] | null {
  const manifests = child.constraints.filter(value => value.startsWith(FILE_ANALYSIS_MANIFEST))
  if (!manifests.length) return null
  try {
    const batches = manifests.map(manifest => JSON.parse(manifest.slice(FILE_ANALYSIS_MANIFEST.length))) as { group: string; partitions: FileAnalysisPartition[] }[]
    const group = batches[batches.length - 1].group
    if (typeof group !== 'string') return null
    const values = batches.filter(batch => batch.group === group).flatMap(batch => batch.partitions)
    if (!Array.isArray(values) || values.length === 0 || values.length > 32
      || values.some(value => typeof value.fileId !== 'string' || typeof value.revision !== 'string'
        || !Number.isSafeInteger(value.startPage) || !Number.isSafeInteger(value.endPage)
        || value.startPage < 1 || value.endPage < value.startPage || value.endPage - value.startPage >= 20)) return null
    return values
  } catch (_error) { return null }
}

export function fileAnalysisCoverage(assignments: FileAnalysisPartition[], evidence: HarnessEvidence[]) {
  const observed = new Map<string, string>()
  const failures = new Map<string, 'stale' | 'unavailable'>()
  for (const item of evidence) {
    if (item.kind !== 'tool_result' || item.source !== 'read_document') continue
    try {
      const value = JSON.parse(item.summary)
      const data = documentReadObservation(value)
      if (data && item.verdict !== 'failed') observed.set(JSON.stringify([data.fileId, data.revision, data.page]), item.id)
      if (value.success === false && ['stale', 'unavailable'].includes(value.status)) {
        failures.set(JSON.stringify([value.fileId, value.revision, value.page]), value.status)
      }
    } catch (_error) { /* Non-structured legacy observations do not establish coverage. */ }
  }
  const pages = assignments.flatMap(partition => Array.from(
    { length: partition.endPage - partition.startPage + 1 }, (_, offset) => {
      const page = partition.startPage + offset
      const evidenceRef = observed.get(JSON.stringify([partition.fileId, partition.revision, page]))
      return { fileId: partition.fileId, revision: partition.revision, page, ...(evidenceRef ? { evidenceRef } : {}) }
    },
  ))
  const missing = pages.filter(page => !page.evidenceRef)
  return {
    assignments, examined: pages.filter(page => page.evidenceRef), missing,
    stale: missing.filter(page => failures.get(JSON.stringify([page.fileId, page.revision, page.page])) === 'stale'),
    unavailable: missing.filter(page => failures.get(JSON.stringify([page.fileId, page.revision, page.page])) === 'unavailable'),
    complete: missing.length === 0,
    note: 'Coverage records successful page observations, not proof that every fact was understood or extracted. Verify findings and exact aggregates against source evidence.',
  }
}
