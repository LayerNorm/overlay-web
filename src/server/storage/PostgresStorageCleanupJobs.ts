import 'server-only'

import { randomUUID } from 'node:crypto'
import type { ObjectStore } from '@overlay/app-core'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { durableJobs } from '@/server/database/postgres/schema'
import {
  isOwnedFileR2Key,
  isOwnedOutputR2Key,
} from '@/server/storage/storage-keys'
import type { DurableJobHandler } from '@/server/jobs/DurableJobRepository'

export const STORAGE_DELETE_OBJECTS_JOB = 'storage.delete-objects'
const STORAGE_DELETE_CHUNK_SIZE = 250

type StorageCleanupDb = Pick<OverlayPostgresDb, 'insert'>

export async function enqueueStorageCleanupJobs(
  db: StorageCleanupDb,
  args: {
    dedupeKey: string
    keys: readonly string[]
    reason: string
    userId: string
  },
): Promise<number> {
  const keys = uniqueOwnedKeys(args.userId, args.keys)
  let enqueued = 0
  for (let offset = 0; offset < keys.length; offset += STORAGE_DELETE_CHUNK_SIZE) {
    const chunk = keys.slice(offset, offset + STORAGE_DELETE_CHUNK_SIZE)
    const inserted = await db
      .insert(durableJobs)
      .values({
        availableAt: new Date(),
        id: randomUUID(),
        type: STORAGE_DELETE_OBJECTS_JOB,
        payload: {
          keys: chunk,
          reason: args.reason,
          userId: args.userId,
        },
        dedupeKey: `${args.dedupeKey}:${offset / STORAGE_DELETE_CHUNK_SIZE}`,
        maxAttempts: 10,
        priority: 25,
      })
      .onConflictDoNothing()
      .returning({ id: durableJobs.id })
    enqueued += inserted.length
  }
  return enqueued
}

export function createStorageDeleteJobHandler(
  objectStore: Pick<ObjectStore, 'deleteObject'>,
): DurableJobHandler {
  return async (job, context) => {
    const userId = stringPayload(job.payload.userId, 'userId')
    const keys = arrayPayload(job.payload.keys)
    const ownedKeys = uniqueOwnedKeys(userId, keys)
    if (ownedKeys.length !== keys.length) {
      throw new Error('Storage cleanup job contains an invalid or duplicate object key')
    }
    for (let index = 0; index < ownedKeys.length; index += 1) {
      await objectStore.deleteObject(ownedKeys[index]!)
      if ((index + 1) % 25 === 0 && !(await context.heartbeat())) {
        throw new Error('Storage cleanup job lost its lease')
      }
    }
    return {
      deleted: ownedKeys.length,
      reason: typeof job.payload.reason === 'string' ? job.payload.reason : 'unspecified',
    }
  }
}

function uniqueOwnedKeys(userId: string, keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => key.trim()).filter((key) => (
    key && (isOwnedFileR2Key(userId, key) || isOwnedOutputR2Key(userId, key))
  )))]
}

function stringPayload(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Storage cleanup job is missing ${label}`)
  }
  return value.trim()
}

function arrayPayload(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('Storage cleanup job contains invalid keys')
  }
  return value
}
