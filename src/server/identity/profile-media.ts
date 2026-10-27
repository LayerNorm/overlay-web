import 'server-only'

import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { NextRequest, NextResponse } from 'next/server'
import { deleteObject, uploadBuffer } from '@/server/storage/object-store'

export const MAX_IDENTITY_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_IDENTITY_REQUEST_BYTES = MAX_IDENTITY_UPLOAD_BYTES + 64 * 1024
const MAX_IMAGE_PIXELS = 24_000_000

export async function limitIdentityUploadBody(request: NextRequest): Promise<NextRequest | NextResponse> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_IDENTITY_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Upload exceeds the 5 MB limit.' }, { status: 413 })
  }
  if (!request.body) return NextResponse.json({ error: 'Upload body is required.' }, { status: 400 })

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_IDENTITY_REQUEST_BYTES) {
      await reader.cancel()
      return NextResponse.json({ error: 'Upload exceeds the 5 MB limit.' }, { status: 413 })
    }
    chunks.push(value)
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  return new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  })
}

export async function processIdentityImage(file: File): Promise<Buffer> {
  if (!file.size || file.size > MAX_IDENTITY_UPLOAD_BYTES) throw new Error('IDENTITY_UPLOAD_SIZE')
  const input = Buffer.from(await file.arrayBuffer())
  const format = detectImageFormat(input)
  if (!format || format !== file.type) {
    throw new Error('IDENTITY_UPLOAD_FORMAT')
  }
  try {
    const image = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new Error('IDENTITY_UPLOAD_DIMENSIONS')
    }
    return await image
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .webp({ quality: 86 })
      .toBuffer()
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('IDENTITY_UPLOAD_')) throw error
    throw new Error('IDENTITY_UPLOAD_DECODE')
  }
}

export function identityObjectKey(scope: string, ownerId: string): string {
  return `identity/${scope}/${encodeURIComponent(ownerId)}/${randomUUID()}.webp`
}

export async function saveIdentityImage(key: string, image: Buffer): Promise<void> {
  await uploadBuffer(key, image, 'image/webp')
}

export async function removeIdentityImage(key: string | null | undefined): Promise<void> {
  if (key) await deleteObject(key).catch((_error) => undefined)
}

export function identityUploadError(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : ''
  if (code.startsWith('IDENTITY_UPLOAD_')) {
    return NextResponse.json({ error: 'Choose a valid PNG, JPEG, or WebP image under 5 MB.' }, { status: 400 })
  }
  return NextResponse.json({ error: 'Could not process the uploaded image.' }, { status: 500 })
}

function detectImageFormat(input: Buffer): string | null {
  if (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png'
  }
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) {
    return 'image/jpeg'
  }
  if (input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}
