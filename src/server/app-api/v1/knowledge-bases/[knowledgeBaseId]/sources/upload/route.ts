import { NextResponse, type NextRequest } from 'next/server'
import type { FileRecord } from '@/server/files/FileRepository'
import { fileIngestErrorResponse, fileService } from '@/server/files/http'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse, requiredKnowledgeBaseId } from '../../../errors'
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  const knowledgeBaseId = await requiredKnowledgeBaseId(context)
  const form = context.parsedFormData ?? await request.formData().catch((_error) => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }

  let ingested: Awaited<ReturnType<typeof fileService.ingestDocument>>
  try {
    ingested = await fileService.ingestDocument({
      file,
      userId: context.auth.userId,
    })
  } catch (error) {
    return fileIngestErrorResponse(error)
  }

  try {
    const rows = await Promise.all(ingested.ids.map(async (fileId) => (
      await fileService.getOrListFiles({ fileId, userId: context.auth.userId }) as FileRecord
    )))
    const content = rows
      .map((row) => row.content ?? row.textContent ?? '')
      .filter(Boolean)
      .join('\n\n')
    if (!content.trim()) throw new Error('Uploaded source has no extracted text')

    const result = await getOverlayServerContext().knowledgeSourceIngestionService.createTextSource({
      content,
      knowledgeBaseId,
      kind: 'file',
      metadata: { fileIds: ingested.ids, originalFileId: ingested.id },
      mimeType: file.type || 'application/octet-stream',
      sourceRef: ingested.id ? `file:${ingested.id}` : undefined,
      title: ingested.name,
      userId: context.auth.userId,
    })
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    if (ingested.id) {
      await fileService.deleteFile({ fileId: ingested.id, userId: context.auth.userId })
        .catch((_error) => undefined)
    }
    return knowledgeBaseErrorResponse('upload source to', error)
  }
}
