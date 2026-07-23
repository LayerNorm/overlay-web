import { NextResponse } from 'next/server'
import { KnowledgeBaseServiceError } from '@/server/knowledge-bases'
import { logger } from '@/server/observability/logger'

export function knowledgeBaseErrorResponse(operation: string, error: unknown) {
  if (error instanceof KnowledgeBaseServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  logger.error(`[knowledge-bases/${operation}]`, error)
  return NextResponse.json({ error: `Failed to ${operation} knowledge base` }, { status: 500 })
}

export async function requiredKnowledgeBaseId(context: { params: Promise<Record<string, string | string[]>> }) {
  const value = (await context.params).knowledgeBaseId
  const id = Array.isArray(value) ? value[0] : value
  if (!id?.trim()) throw new KnowledgeBaseServiceError('Knowledge base not found', 404)
  return id.trim()
}
