import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import {
  getMaxPresignedUploadBytes,
  getR2PresignTtlSeconds,
  downloadBuffer as downloadR2Buffer,
  headObject as headR2Object,
  uploadBuffer as uploadR2Buffer,
} from '@/server/storage/r2'
export { keyForFile, keyForOutput } from '@/server/storage/storage-keys'

type HeadableObjectStore = {
  headObject(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null>
}

type WritableObjectStore = {
  uploadBuffer(
    key: string,
    body: Buffer | Uint8Array | string,
    mimeType: string,
  ): Promise<void>
}

export async function generatePresignedUploadUrl(
  key: string,
  mimeType: string,
  sizeBytes: number,
  ttlSeconds?: number,
): Promise<string> {
  void sizeBytes
  void ttlSeconds
  return (await getOverlayServerContext().objectStore.getUploadUrl(key, mimeType)).url
}

export async function generatePresignedDownloadUrl(
  key: string,
  ttlSeconds?: number,
): Promise<string> {
  void ttlSeconds
  return getOverlayServerContext().objectStore.getDownloadUrl(key)
}

export async function deleteObject(key: string): Promise<void> {
  await getOverlayServerContext().objectStore.deleteObject(key)
}

export async function deleteObjects(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => deleteObject(key)))
}

export async function headObject(
  key: string,
): Promise<{ sizeBytes: number; contentType: string | undefined } | null> {
  const objectStore = getOverlayServerContext().objectStore
  if (isHeadableObjectStore(objectStore)) {
    return objectStore.headObject(key)
  }
  return headR2Object(key)
}

export async function uploadBuffer(
  key: string,
  body: Buffer | Uint8Array | string,
  mimeType: string,
): Promise<void> {
  const objectStore = getOverlayServerContext().objectStore
  if (isWritableObjectStore(objectStore)) {
    return objectStore.uploadBuffer(key, body, mimeType)
  }
  return uploadR2Buffer(key, body, mimeType)
}

/** Reads an object through the configured store (R2 or S3-compatible). */
export async function downloadBuffer(key: string, maximumBytes?: number): Promise<Uint8Array | null> {
  const objectStore = getOverlayServerContext().objectStore
  if (typeof objectStore.downloadBuffer === 'function') {
    return await objectStore.downloadBuffer(key, maximumBytes).catch((_error) => null)
  }
  const bytes = await downloadR2Buffer(key)
  return bytes ? new Uint8Array(bytes) : null
}

function isHeadableObjectStore(value: unknown): value is HeadableObjectStore {
  return Boolean(value && typeof (value as HeadableObjectStore).headObject === 'function')
}

function isWritableObjectStore(value: unknown): value is WritableObjectStore {
  return Boolean(value && typeof (value as WritableObjectStore).uploadBuffer === 'function')
}

export {
  getMaxPresignedUploadBytes,
  getR2PresignTtlSeconds,
}
