import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import type { z, ZodTypeAny } from 'zod/v3'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { queryParamsToObject } from '@/shared/schemas/api-boundary'

type ValidatedInput<T> = { ok: true; data: T } | { ok: false; response: NextResponse }

const validationError = (issues: unknown): NextResponse =>
  NextResponse.json({ error: 'Invalid request', issues }, { status: 400 })
const hasParsedValues = (value: Record<string, unknown>): boolean => Object.keys(value).length > 0

async function readJsonBody(request: NextRequest): Promise<unknown> {
  const text = await request.clone().text()
  return text.trim() ? JSON.parse(text) : {}
}

function parseValidated<TSchema extends ZodTypeAny>(
  schema: TSchema,
  input: unknown,
): ValidatedInput<z.infer<TSchema>> {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, response: validationError(result.error.issues) }
}

export async function readValidatedJson<TSchema extends ZodTypeAny>(request: NextRequest, context: AppApiRouteContext, schema: TSchema): Promise<ValidatedInput<z.infer<TSchema>>> {
  let body: unknown
  try {
    body = hasParsedValues(context.parsedJson) ? context.parsedJson : await readJsonBody(request)
  } catch (_error) {
    void _error
    return { ok: false, response: validationError([{ message: 'Request body must be valid JSON' }]) }
  }
  return parseValidated(schema, body)
}

export function readValidatedQuery<TSchema extends ZodTypeAny>(request: NextRequest, context: AppApiRouteContext, schema: TSchema): ValidatedInput<z.infer<TSchema>> {
  const query = hasParsedValues(context.parsedQuery) ? context.parsedQuery : queryParamsToObject(request.nextUrl.searchParams)
  return parseValidated(schema, query)
}
