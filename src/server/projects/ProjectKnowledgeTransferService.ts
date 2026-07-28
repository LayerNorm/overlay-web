import 'server-only'

import type { KnowledgeSource, KnowledgeSourceVersion } from '@overlay/app-core'
import type { FileRepository } from '@/server/files/FileRepository'
import type { KnowledgeBaseService } from '@/server/knowledge-bases/KnowledgeBaseService'
import { KnowledgeBaseServiceError } from '@/server/knowledge-bases/KnowledgeBaseService'
import type { KnowledgeSourceIngestionService } from '@/server/knowledge-bases/KnowledgeSourceIngestionService'
import { readSourceProvenance } from '@/shared/knowledge/source-provenance'

/**
 * Moves material between a project's working area and a knowledge base, always
 * through an explicit command.
 *
 * The product rule this enforces: project files are working material and never
 * become trusted organizational knowledge on their own. Promotion is a deliberate
 * act, and it captures a **snapshot** rather than a live link, so editing the
 * project file afterwards cannot silently rewrite what the knowledge base says.
 */

export type PromotionResult = {
  source: KnowledgeSource
  version: KnowledgeSourceVersion
  jobId: string
}

export class ProjectKnowledgeTransferService {
  constructor(private readonly deps: {
    bases: KnowledgeBaseService
    files: FileRepository
    ingestion: KnowledgeSourceIngestionService
    notes: {
      createNote(args: {
        userId: string
        title: string
        content: string
        projectId?: string
      }): Promise<{ id: string }>
    }
  }) {}

  /**
   * Copies a project file's extracted text into a knowledge base as a new source,
   * recording where it came from.
   *
   * Project ownership is verified by the caller; knowledge-base edit access is
   * verified inside the ingestion path.
   */
  async promoteProjectFileToKnowledgeBase(args: {
    accessToken?: string
    fileId: string
    knowledgeBaseId: string
    projectId: string
    title?: string
    userId: string
  }): Promise<PromotionResult> {
    const file = await this.deps.files.getFile({
      accessToken: args.accessToken,
      fileId: args.fileId,
      userId: args.userId,
    })
    if (!file) throw new KnowledgeBaseServiceError('File not found', 404)

    const content = readableText(file)
    if (!content) {
      throw new KnowledgeBaseServiceError(
        'This file has no extracted text yet, so it cannot be promoted. It may still be processing.',
        409,
      )
    }

    return await this.deps.ingestion.createTextSource({
      content,
      knowledgeBaseId: args.knowledgeBaseId,
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : 'text/plain',
      // A snapshot, not a pointer: later edits to the project file must not
      // change what the knowledge base is understood to assert.
      provenance: {
        origin: 'project-promotion',
        promotedFromProjectId: args.projectId,
        promotedFromArtifactId: args.fileId,
        label: typeof file.name === 'string' ? file.name : undefined,
      },
      sourceRef: args.fileId,
      title: args.title?.trim() || (typeof file.name === 'string' ? file.name : 'Promoted file'),
      userId: args.userId,
    })
  }

  /**
   * Copies a knowledge-base source into a project as an editable working note.
   *
   * The copy is working material, so it deliberately does not stay in sync with
   * the knowledge base. Its provenance records the origin so a reader can tell
   * where the text came from.
   */
  async copyKnowledgeSourceToProject(args: {
    knowledgeBaseId: string
    projectId: string
    sourceId: string
    userId: string
  }): Promise<{ noteId: string; title: string }> {
    // listSources enforces read access to the base and reveals nothing about
    // bases the user cannot see.
    const sources = await this.deps.bases.listSources({
      knowledgeBaseId: args.knowledgeBaseId,
      userId: args.userId,
    })
    const detail = sources.find(({ source }) => source.id === args.sourceId)
    if (!detail) throw new KnowledgeBaseServiceError('Knowledge source not found', 404)

    const preview = await this.deps.bases.getExtractionPreview({
      knowledgeBaseId: args.knowledgeBaseId,
      // Generous ceiling: this becomes an editable note, not a retrieval snippet.
      limit: 20_000,
      sourceId: args.sourceId,
      userId: args.userId,
    })
    const origin = readSourceProvenance(detail.source.metadata)
    const attribution = [
      `Copied from knowledge base source "${detail.source.title}".`,
      origin?.ref ? `Origin: ${origin.ref}` : '',
      'This is a working copy. It does not stay in sync with the knowledge base.',
      preview.truncated ? `Truncated at ${preview.text.length} characters.` : '',
    ].filter(Boolean).join('\n')

    const created = await this.deps.notes.createNote({
      content: `${attribution}\n\n---\n\n${preview.text}`,
      projectId: args.projectId,
      title: detail.source.title,
      userId: args.userId,
    })
    return { noteId: created.id, title: detail.source.title }
  }
}

/** Extracted text for a file, whichever field the active backend populated. */
function readableText(file: Record<string, unknown>): string {
  for (const key of ['textContent', 'content']) {
    const value = file[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}
