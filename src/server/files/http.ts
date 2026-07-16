import 'server-only'

import { logger } from '@/server/observability/logger'
import { NextResponse } from 'next/server'
import { R2GlobalBudgetError } from '@/server/storage/r2-budget'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { FileService, FileServiceError } from './FileService'
import type { FileRepository } from './FileRepository'

export const fileService = new FileService({
  repository: repositoryProxy<FileRepository>(
    () => getOverlayServerContext().appData.repositories.files,
  ),
})

export function fileErrorResponse(error: unknown, fallback = 'Failed to save file') {
  if (error instanceof FileServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  if (error instanceof R2GlobalBudgetError) {
    return NextResponse.json({ error: 'Overlay storage limit reached.' }, { status: 403 })
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('storage_limit_exceeded')) {
    return NextResponse.json({ error: 'Overlay storage limit reached.' }, { status: 403 })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export function fileUploadUrlErrorResponse(error: unknown) {
  if (error instanceof FileServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  if (error instanceof R2GlobalBudgetError) {
    return NextResponse.json({ error: 'Overlay storage limit reached.' }, { status: 403 })
  }
  const message = error instanceof Error ? error.message : 'Failed to generate upload URL'
  if (message.includes('storage_limit_exceeded')) {
    return NextResponse.json({ error: 'Overlay storage limit reached.' }, { status: 403 })
  }
  return NextResponse.json({ error: message }, { status: 500 })
}

export function filePresignErrorResponse(error: unknown) {
  if (error instanceof FileServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  if (error instanceof R2GlobalBudgetError) {
    return NextResponse.json(
      { error: 'storage_limit_exceeded', message: 'Global R2 storage cap reached. Contact support.' },
      { status: 403 },
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('storage_limit_exceeded')) {
    return NextResponse.json(
      { error: 'storage_limit_exceeded', message: 'Not enough Overlay storage remaining.' },
      { status: 403 },
    )
  }
  logger.error('[FilesPresign] Error:', error)
  return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 })
}

export function fileIngestErrorResponse(error: unknown) {
  if (error instanceof FileServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  if (error instanceof R2GlobalBudgetError) {
    return NextResponse.json({ error: 'Overlay storage limit reached.' }, { status: 403 })
  }
  if (error instanceof Error && error.message.includes('storage_limit_exceeded')) {
    return NextResponse.json({ error: 'Overlay storage limit reached.' }, { status: 403 })
  }
  if (error instanceof Error && error.message.includes('INTERNAL_API_SECRET')) {
    logger.error('[ingest-document] missing INTERNAL_API_SECRET')
    return NextResponse.json({ error: 'Server configuration error (auth secret).' }, { status: 503 })
  }
  if (error instanceof Error && error.message.includes('[R2]')) {
    logger.error('[ingest-document] R2 misconfiguration:', error.message)
    return NextResponse.json({ error: 'File storage is not available.' }, { status: 503 })
  }
  logger.error('[ingest-document]', error)
  return NextResponse.json({ error: 'Failed to ingest document' }, { status: 500 })
}
