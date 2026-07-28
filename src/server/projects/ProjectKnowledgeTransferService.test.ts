import assert from 'node:assert/strict'
import test from 'node:test'
import { ProjectKnowledgeTransferService } from './ProjectKnowledgeTransferService'
import { KnowledgeBaseServiceError } from '@/server/knowledge-bases/KnowledgeBaseService'
import { readSourceProvenance } from '@/shared/knowledge/source-provenance'
import type { FileRepository } from '@/server/files/FileRepository'
import type { KnowledgeBaseService } from '@/server/knowledge-bases/KnowledgeBaseService'
import type { KnowledgeSourceIngestionService } from '@/server/knowledge-bases/KnowledgeSourceIngestionService'
import {
  withSourceProvenance,
} from '@/shared/knowledge/source-provenance'

type CreatedSource = Parameters<KnowledgeSourceIngestionService['createTextSource']>[0]

function build(overrides: {
  file?: Record<string, unknown> | null
  sources?: Array<{ id: string; title: string; metadata?: Record<string, unknown> }>
  preview?: { text: string; totalChars: number; truncated: boolean } | Error
} = {}) {
  const created: CreatedSource[] = []
  const notes: Array<{ title: string; content: string; projectId?: string }> = []
  const service = new ProjectKnowledgeTransferService({
    bases: {
      async listSources() {
        return (overrides.sources ?? []).map((source) => ({
          membership: { enabled: true },
          source: { id: source.id, title: source.title, status: 'ready', metadata: source.metadata ?? {} },
        }))
      },
      async getExtractionPreview() {
        if (overrides.preview instanceof Error) throw overrides.preview
        return overrides.preview ?? { text: 'source body', totalChars: 11, truncated: false }
      },
    } as unknown as KnowledgeBaseService,
    files: {
      async getFile() {
        return overrides.file === undefined
          ? { _id: 'file-1', name: 'Draft.md', textContent: 'draft body v1' }
          : overrides.file
      },
    } as unknown as FileRepository,
    ingestion: {
      async createTextSource(args: CreatedSource) {
        created.push(args)
        return {
          source: { id: 'source-new', contentHash: 'hash' },
          version: { id: 'version-new' },
          jobId: 'job-1',
        }
      },
    } as unknown as KnowledgeSourceIngestionService,
    notes: {
      async createNote(args) {
        notes.push(args)
        return { id: `note-${notes.length}` }
      },
    },
  })
  return { service, created, notes }
}

test('promotion records where the file came from', async () => {
  const { service, created } = build()
  const result = await service.promoteProjectFileToKnowledgeBase({
    fileId: 'file-1',
    knowledgeBaseId: 'kb-1',
    projectId: 'project-1',
    userId: 'user-1',
  })
  assert.equal(result.source.id, 'source-new')
  assert.equal(created.length, 1)

  const provenance = created[0]!.provenance
  assert.equal(provenance?.origin, 'project-promotion')
  assert.equal(provenance?.promotedFromProjectId, 'project-1')
  assert.equal(provenance?.promotedFromArtifactId, 'file-1')
  assert.equal(created[0]!.title, 'Draft.md')
})

test('promotion copies the text so later project edits cannot rewrite knowledge', async () => {
  const { service, created } = build()
  await service.promoteProjectFileToKnowledgeBase({
    fileId: 'file-1',
    knowledgeBaseId: 'kb-1',
    projectId: 'project-1',
    userId: 'user-1',
  })
  // The content is passed by value into the knowledge base rather than stored as
  // a pointer back to the file, which is what makes this a snapshot.
  assert.equal(created[0]!.content, 'draft body v1')
  assert.equal(created[0]!.sourceRef, 'file-1')
})

test('a file with no extracted text is refused rather than promoted empty', async () => {
  const { service, created } = build({ file: { _id: 'file-1', name: 'Scan.pdf' } })
  await assert.rejects(
    () => service.promoteProjectFileToKnowledgeBase({
      fileId: 'file-1',
      knowledgeBaseId: 'kb-1',
      projectId: 'project-1',
      userId: 'user-1',
    }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 409,
  )
  assert.equal(created.length, 0, 'nothing may be written when there is no text')
})

test('a missing file is a not-found rather than a silent no-op', async () => {
  const { service } = build({ file: null })
  await assert.rejects(
    () => service.promoteProjectFileToKnowledgeBase({
      fileId: 'missing',
      knowledgeBaseId: 'kb-1',
      projectId: 'project-1',
      userId: 'user-1',
    }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 404,
  )
})

test('copying a knowledge source creates a working note that names its origin', async () => {
  const { service, notes } = build({
    sources: [{
      id: 'source-1',
      title: 'Refund policy',
      metadata: withSourceProvenance({}, { origin: 'url', ref: 'https://example.com/policy' }),
    }],
  })
  const result = await service.copyKnowledgeSourceToProject({
    knowledgeBaseId: 'kb-1',
    projectId: 'project-1',
    sourceId: 'source-1',
    userId: 'user-1',
  })
  assert.equal(result.title, 'Refund policy')
  assert.equal(notes.length, 1)
  assert.equal(notes[0]!.projectId, 'project-1')
  assert.match(notes[0]!.content, /Copied from knowledge base source "Refund policy"/)
  assert.match(notes[0]!.content, /https:\/\/example\.com\/policy/)
  // The copy is explicitly working material, not a synced mirror.
  assert.match(notes[0]!.content, /does not stay in sync/)
  assert.match(notes[0]!.content, /source body/)
})

test('copying a source outside the knowledge base is refused', async () => {
  const { service, notes } = build({ sources: [{ id: 'source-1', title: 'In base' }] })
  await assert.rejects(
    () => service.copyKnowledgeSourceToProject({
      knowledgeBaseId: 'kb-1',
      projectId: 'project-1',
      sourceId: 'source-from-elsewhere',
      userId: 'user-1',
    }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 404,
  )
  assert.equal(notes.length, 0)
})

test('promoted provenance survives a metadata round trip', () => {
  const metadata = withSourceProvenance({ content: 'body' }, {
    origin: 'project-promotion',
    promotedFromProjectId: 'project-1',
    promotedFromArtifactId: 'file-1',
  })
  const read = readSourceProvenance(metadata)
  assert.equal(read?.origin, 'project-promotion')
  assert.equal(read?.promotedFromProjectId, 'project-1')
  assert.equal(read?.promotedFromArtifactId, 'file-1')
})
