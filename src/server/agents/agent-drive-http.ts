import 'server-only'

import { z } from 'zod'
import { ConvexError } from 'convex/values'
import { readBoundedStorageBody } from '@/server/storage/read-bounded-storage-body'
import type { AgentDriveManifestService, AgentDriveHostManifestEntry } from './AgentDriveManifestService'

import { driveMetadataBodySchema } from './agent-drive-metadata'

const MAX_BODY_BYTES = 32 * 1024
const MAX_RANGE_BYTES = 1024 * 1024
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('manifest') }).strict(),
  driveMetadataBodySchema,
  z.object({ action: z.literal('download'), entry: z.record(z.unknown()), downloadMac: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    offset: z.number().int().nonnegative().max(16 * 1024 * 1024), length: z.number().int().positive().max(MAX_RANGE_BYTES) }).strict(),
])
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization' }
export type DriveHttpDependencies = {
  enabled(): boolean
  service(): Pick<AgentDriveManifestService, 'manifest' | 'download' | 'metadata'>
  limit(request: Request, token: string): Promise<Response | null>
}
/** Bearer-only machine transport. Cookies, URL tokens and host-selected scope do not authorize it. */
export async function handleAgentDriveRequest(request: Request, dependencies: DriveHttpDependencies): Promise<Response> {
  try {
    if (!dependencies.enabled()) return failure(404, 'DRIVE_DISABLED')
    const authorization = request.headers.get('authorization') ?? ''
    const token = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : ''
    if (!token.startsWith('ovdrive_') || token.length > 8192) return failure(401, 'DRIVE_UNAUTHORIZED')
    const limited = await dependencies.limit(request, token)
    if (limited) { for (const [name, value] of Object.entries(headers)) limited.headers.set(name, value); return limited }
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return failure(415, 'DRIVE_JSON_REQUIRED')
    const body = await readBody(request)
    const service = dependencies.service()
    if (body.action === 'manifest') return manifestResponse((await service.manifest(token)).entries)
    if (body.action === 'metadata') {
      return Response.json(await service.metadata(token, body), { headers })
    }
    const bytes = await service.download(token, body)
    if (body.offset > bytes.length || (bytes.length > 0 && body.offset === bytes.length)) return failure(416, 'DRIVE_RANGE_INVALID')
    const chunk = bytes.slice(body.offset, body.offset + body.length)
    return new Response(Uint8Array.from(chunk).buffer, {
      status: bytes.length ? 206 : 200,
      headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(chunk.length),
        'X-Overlay-Drive-Size': String(bytes.length),
        ...(bytes.length ? { 'Content-Range': `bytes ${body.offset}-${body.offset + chunk.length - 1}/${bytes.length}` } : {}),
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure(400, 'DRIVE_INVALID_REQUEST')
    // Production Convex redacts developer messages. Expected failures travel as
    // application data; plain-message parsing supports older backend deployments.
    const message = error instanceof Error ? error.message : ''
    const code = error instanceof ConvexError && typeof error.data === 'string' ? error.data
      : /(?:^|\n)(?:Uncaught Error: )?((?:DRIVE|STORAGE_READ)_[A-Z_]+)[ \t]*(?=\n|$)/.exec(message)?.[1] ?? ''
    const statuses: Record<string, number> = {
      DRIVE_DISABLED: 404, DRIVE_UNAUTHORIZED: 401, DRIVE_RUN_UNAVAILABLE: 403, DRIVE_SCOPE_CHANGED: 403,
      DRIVE_EDIT_DENIED: 403, DRIVE_INVALID_METADATA: 403, DRIVE_REQUEST_CONFLICT: 409, DRIVE_PATH_CONFLICT: 409, DRIVE_DIRECTORY_NOT_EMPTY: 409,
      DRIVE_UNSAFE_PATH: 400, DRIVE_INVALID_DOWNLOAD: 403, DRIVE_SOURCE_CHANGED: 409, DRIVE_FILE_UNAVAILABLE: 404,
      DRIVE_TOO_MANY_ENTRIES: 413, DRIVE_METADATA_LIMIT: 413, DRIVE_FILE_TOO_LARGE: 413,
      STORAGE_READ_LIMIT_EXCEEDED: 413, STORAGE_READ_SIZE_CHANGED: 409,
      DRIVE_SNAPSHOT_UNAVAILABLE: 503, DRIVE_BACKEND_UNAVAILABLE: 503,
    }
    return failure(statuses[code] ?? 500, statuses[code] ? code : 'DRIVE_REQUEST_FAILED')
  }
}

async function readBody(request: Request) {
  const length = request.headers.get('content-length')
  const declared = length === null ? undefined : Number(length)
  if (length !== null && !/^(0|[1-9][0-9]*)$/.test(length)) throw new SyntaxError('Invalid request length')
  if (declared !== undefined && (!Number.isSafeInteger(declared) || declared < 0)) throw new SyntaxError('Invalid request length')
  let bytes: Uint8Array
  try { bytes = request.body ? await readBoundedStorageBody(request.body, MAX_BODY_BYTES, declared) : new Uint8Array() }
  catch (error) { if (error instanceof Error && error.message === 'STORAGE_READ_SIZE_CHANGED') throw new SyntaxError('Invalid request length'); throw error }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch (_error) { throw new SyntaxError('Invalid UTF-8') }
  return bodySchema.parse(JSON.parse(text))
}

function failure(status: number, code: string) {
  return Response.json({ error: code }, { status, headers: { ...headers, ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) } })
}

/** Framed stream with an explicit terminal record so a truncated manifest can never authorize deletions. */
function manifestResponse(entries: AgentDriveHostManifestEntry[]) {
  let index = -1
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === -1) controller.enqueue(encoder.encode('{"type":"manifest","version":1}\n'))
      else if (index < entries.length) controller.enqueue(encoder.encode(JSON.stringify({ type: 'entry', entry: entries[index] }) + '\n'))
      else { controller.enqueue(encoder.encode(JSON.stringify({ type: 'complete', entries: entries.length }) + '\n')); controller.close() }
      index++
    },
    cancel() { index = entries.length + 1 },
  })
  return new Response(stream, { headers: { ...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8' } })
}
