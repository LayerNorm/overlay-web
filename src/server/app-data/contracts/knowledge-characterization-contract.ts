import 'server-only'

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import type { FileRepository } from '@/server/files/FileRepository'
import type { KnowledgeSearchRepository } from '@/server/knowledge/KnowledgeSearchRepository'
import {
  KNOWLEDGE_CHARACTERIZATION_CORPUS,
  characterizeKnowledgeBackend,
  type CharacterizationFixture,
  type CharacterizationMetrics,
  type CharacterizationSourceKey,
} from '@/server/knowledge/characterization'
import type { MemoryRepository } from '@/server/memory/MemoryRepository'
import type { UserRepository } from '@/server/users/types'

export type KnowledgeCharacterizationBackend = {
  awaitIndexed(fixture: CharacterizationFixture): Promise<void>
  cleanupUser(userId: string): Promise<void>
  files: FileRepository
  memories: MemoryRepository
  name: string
  search: KnowledgeSearchRepository
  users: UserRepository
}

export async function runKnowledgeCharacterizationContract(
  t: TestContext,
  backend: KnowledgeCharacterizationBackend,
): Promise<CharacterizationMetrics> {
  const suffix = randomUUID()
  const userId = `knowledge_characterization_${backend.name}_${suffix}`
  const foreignUserId = `knowledge_characterization_foreign_${backend.name}_${suffix}`
  let fixture: CharacterizationFixture | undefined

  try {
    await upsertUser(backend.users, userId)
    await upsertUser(backend.users, foreignUserId)
    const sourceIds = {} as Record<CharacterizationSourceKey, string>

    for (const [key, source] of Object.entries(KNOWLEDGE_CHARACTERIZATION_CORPUS) as Array<[
      CharacterizationSourceKey,
      (typeof KNOWLEDGE_CHARACTERIZATION_CORPUS)[CharacterizationSourceKey],
    ]>) {
      const sourceUserId = source.owner === 'foreign' ? foreignUserId : userId
      if (source.kind === 'file') {
        const fileId = await backend.files.createFile({
          content: source.content,
          contentHash: createHash('sha256').update(source.content).digest('hex'),
          kind: 'upload',
          name: source.name,
          textContent: source.content,
          type: 'file',
          userId: sourceUserId,
        })
        assert.ok(fileId, `${backend.name} failed to create ${key}`)
        sourceIds[key] = fileId
      } else {
        const memory = await backend.memories.create({
          clientId: `knowledge-${key}-${suffix}`,
          content: source.content,
          source: 'manual',
          userId: sourceUserId,
        })
        sourceIds[key] = memory._id
      }
    }

    fixture = {
      foreignUserId,
      sourceIds,
      userId,
    }
    await backend.awaitIndexed(fixture)

    const metrics = await characterizeKnowledgeBackend({
      backend: backend.name,
      fixture,
      search: backend.search,
    })
    t.diagnostic(JSON.stringify(metrics))

    await backend.memories.remove({ memoryId: sourceIds.globalMemory, userId })
    await backend.files.removeFile({ fileId: sourceIds.globalFile, userId })
    const removedMemorySearch = await backend.search.hybridSearch({
      billing: contractSearchBilling('removed-memory', userId),
      query: 'Silver Orchard pilot updates',
      userId,
    })
    const removedFileSearch = await backend.search.hybridSearch({
      billing: contractSearchBilling('removed-file', userId),
      query: 'Cedar Lantern deployment',
      userId,
    })
    assert.equal(
      removedMemorySearch.chunks.some((chunk) => chunk.sourceId === sourceIds.globalMemory),
      false,
      `${backend.name} returned a deleted memory`,
    )
    assert.equal(
      removedFileSearch.chunks.some((chunk) => chunk.sourceId === sourceIds.globalFile),
      false,
      `${backend.name} returned a deleted file`,
    )
    return metrics
  } finally {
    await backend.cleanupUser(userId).catch((error) => t.diagnostic(`owner cleanup failed: ${String(error)}`))
    await backend.cleanupUser(foreignUserId).catch((error) => t.diagnostic(`foreign cleanup failed: ${String(error)}`))
  }
}

function contractSearchBilling(label: string, actorUserId: string) {
  const nonce = globalThis.crypto.randomUUID()
  return {
    actorUserId,
    idempotencyKey: nonce,
    operationId: `knowledge.contract.${label}`,
    requestFingerprint: nonce,
  }
}

async function upsertUser(repository: UserRepository, userId: string): Promise<void> {
  const email = `${userId}@example.com`
  await repository.upsertFromIdentity({
    identity: { email, provider: 'none', subject: userId },
    now: new Date(),
    user: {
      email,
      emailVerified: true,
      firstName: 'Knowledge',
      id: userId,
      lastName: 'Characterization',
    },
  })
}
