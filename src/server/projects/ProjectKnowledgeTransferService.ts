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
  /** True when this replaced an earlier capture of the same artifact. */
  updatedExisting: boolean
  /** True when the content matched what was already captured. */
  unchanged: boolean
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

    return await this.captureIntoKnowledgeBase({
      artifactId: args.fileId,
      content,
      knowledgeBaseId: args.knowledgeBaseId,
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : 'text/plain',
      projectId: args.projectId,
      title: args.title?.trim() || (typeof file.name === 'string' ? file.name : 'Promoted file'),
      userId: args.userId,
    })
  }

  /**
   * Captures a chat answer as durable knowledge.
   *
   * Chats never enter a knowledge base on their own: a useful answer becomes
   * knowledge only when someone deliberately says so.
   */
  async saveAnswerAsKnowledge(args: {
    content: string
    conversationId: string
    knowledgeBaseId: string
    messageId: string
    projectId?: string
    title: string
    userId: string
  }): Promise<PromotionResult> {
    const content = args.content?.trim()
    if (!content) {
      throw new KnowledgeBaseServiceError('There is no answer text to save', 400)
    }
    return await this.captureIntoKnowledgeBase({
      artifactId: args.messageId,
      content,
      knowledgeBaseId: args.knowledgeBaseId,
      mimeType: 'text/markdown',
      originLabel: `Chat answer from conversation ${args.conversationId}`,
      projectId: args.projectId,
      title: args.title,
      userId: args.userId,
    })
  }

  /**
   * Shared capture path for every explicit promotion.
   *
   * Re-capturing the same artifact into the same base **updates** it, adding a
   * version rather than failing. `knowledge_sources` carries a unique index on
   * (owner, kind, source_ref) for non-deleted rows, so a naive second promotion
   * would surface as a database error; namespacing the ref by knowledge base also
   * lets the same artifact be promoted into several bases independently.
   */
  private async captureIntoKnowledgeBase(args: {
    artifactId: string
    content: string
    knowledgeBaseId: string
    mimeType: string
    originLabel?: string
    projectId?: string
    title: string
    userId: string
  }): Promise<PromotionResult> {
    const sourceRef = `promotion:${args.knowledgeBaseId}:${args.artifactId}`
    const existing = (await this.deps.bases.listSources({
      knowledgeBaseId: args.knowledgeBaseId,
      userId: args.userId,
    })).find(({ source }) => source.sourceRef === sourceRef)

    if (existing) {
      const replaced = await this.deps.ingestion.replaceTextSource({
        content: args.content,
        sourceId: existing.source.id,
        userId: args.userId,
      })
      return {
        source: replaced.source,
        version: replaced.version,
        jobId: replaced.jobId ?? '',
        updatedExisting: true,
        unchanged: replaced.unchanged,
      }
    }

    const created = await this.deps.ingestion.createTextSource({
      content: args.content,
      knowledgeBaseId: args.knowledgeBaseId,
      mimeType: args.mimeType,
      // A snapshot, not a pointer: later edits to the origin must not change what
      // the knowledge base is understood to assert.
      provenance: {
        origin: 'project-promotion',
        promotedFromProjectId: args.projectId,
        promotedFromArtifactId: args.artifactId,
        label: args.originLabel,
      },
      sourceRef,
      title: args.title,
      userId: args.userId,
    })
    return { ...created, updatedExisting: false, unchanged: false }
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
