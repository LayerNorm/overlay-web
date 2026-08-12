import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { getApiBoundarySchema, queryParamsToObject } from '@/shared/schemas/api-boundary'

/** Maximum request body size for BFF API routes (10 MB). */
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024

export type ParsedApiBoundaryInput = {
  error: NextResponse | null
  parsedQuery: Record<string, unknown>
  parsedJson: Record<string, unknown>
  parsedFormData: FormData | null
}

function validationError(issues: unknown): NextResponse {
  return NextResponse.json(
    {
      error: 'Invalid request',
      issues,
    },
    { status: 400 },
  )
}

async function readJsonBody(request: NextRequest): Promise<unknown> {
  const text = await request.clone().text()
  if (!text.trim()) return {}
  return JSON.parse(text)
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function readOptionalJsonBody(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return {}
  return readJsonBody(request)
}

export async function parseApiBoundaryInput(request: NextRequest): Promise<ParsedApiBoundaryInput> {
  // Reject oversized request bodies early to prevent DoS via large payloads.
  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_BODY_BYTES) {
    return {
      error: NextResponse.json(
        { error: 'request_too_large', message: 'Request body exceeds the maximum allowed size.' },
        { status: 413 },
      ),
      parsedQuery: {},
      parsedJson: {},
      parsedFormData: null,
    }
  }

  const schema = getApiBoundarySchema(request.nextUrl.pathname, request.method)
  const parsed: ParsedApiBoundaryInput = {
    error: null,
    parsedQuery: queryParamsToObject(request.nextUrl.searchParams),
    parsedJson: {},
    parsedFormData: null,
  }

  if (!schema) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      parsed.parsedJson = objectRecord(await readOptionalJsonBody(request).catch((_error) => ({})))
    }
    return parsed
  }

  if (schema.query) {
    const result = schema.query.safeParse(parsed.parsedQuery)
    if (!result.success) return { ...parsed, error: validationError(result.error.issues) }
    parsed.parsedQuery = objectRecord(result.data)
  }

  if (schema.formData) {
    const formData = await request.clone().formData().catch((_error) => undefined)
    const result = schema.formData.safeParse(formData)
    if (!result.success) return { ...parsed, error: validationError(result.error.issues) }
    parsed.parsedFormData = formData ?? null
    return parsed
  }

  if (schema.json && request.method !== 'GET' && request.method !== 'HEAD') {
    const result = schema.json.safeParse(await readJsonBody(request).catch((_error) => undefined))
    if (!result.success) return { ...parsed, error: validationError(result.error.issues) }
    parsed.parsedJson = objectRecord(result.data)
  } else if (request.method !== 'GET' && request.method !== 'HEAD') {
    parsed.parsedJson = objectRecord(await readOptionalJsonBody(request).catch((_error) => ({})))
  }

  return parsed
}

export async function validateApiBoundary(request: NextRequest): Promise<NextResponse | null> {
  const parsed = await parseApiBoundaryInput(request)
  return parsed.error
}
