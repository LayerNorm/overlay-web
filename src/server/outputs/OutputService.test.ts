import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileRepository, FileRecord } from '@/server/files/FileRepository'
import type { FileService } from '@/server/files/FileService'
import { OutputService } from './OutputService'

function fixture() {
  const rows = new Map<string, FileRecord>()
  const deleted: string[] = []
  const repository = {
    async createFile(args: Record<string, unknown> & { userId: string }) {
      const id = `output_${rows.size + 1}`
      rows.set(id, { _id: id, createdAt: Date.now(), updatedAt: Date.now(), ...args } as FileRecord)
      return id
    },
    async updateFile(args: Record<string, unknown> & { fileId: string; userId: string }) {
      const current = rows.get(args.fileId)
      if (!current || current.userId !== args.userId) throw new Error('Unauthorized')
      rows.set(args.fileId, { ...current, ...args, _id: args.fileId, updatedAt: Date.now() })
    },
    async getFile(args: { fileId: string; userId: string }) {
      const row = rows.get(args.fileId)
      return row?.userId === args.userId ? row : null
    },
    async getFileByLegacyOutputId(args: { outputId: string; userId: string }) {
      return [...rows.values()].find((row) => row.legacyOutputId === args.outputId && row.userId === args.userId) ?? null
    },
    async listFiles(args: Record<string, unknown> & { userId: string }) {
      return [...rows.values()].filter((row) => row.userId === args.userId && row.kind === args.kind)
    },
  } as unknown as FileRepository
  const files = {
    async deleteFile(args: { fileId?: string | null; userId: string }) {
      if (!args.fileId || rows.get(args.fileId)?.userId !== args.userId) throw new Error('Not found')
      rows.delete(args.fileId)
      deleted.push(args.fileId)
      return { success: true as const }
    },
    async setShare(args: { fileId?: string; visibility?: 'private' | 'public' }) {
      return { visibility: args.visibility!, token: 'token', url: '/share/f/token' }
    },
  } as unknown as FileService
  return { deleted, repository, rows, service: new OutputService({
    files,
    repository,
    retentionPolicy: () => ({ generatedDays: 7, sandboxDays: 1 }),
  }) }
}

test('OutputService creates and completes canonical generated output files', async () => {
  const { service, rows } = fixture()
  const before = Date.now()
  const id = await service.create({
    userId: 'user_1',
    type: 'image',
    source: 'image_generation',
    status: 'pending',
    prompt: 'draw it',
    modelId: 'image/model',
    fileName: 'image.png',
  })
  assert.equal(rows.get(id)?.kind, 'output')
  assert.ok(Number(rows.get(id)?.expiresAt) >= before + 7 * 24 * 60 * 60_000)

  await service.update({
    outputId: id,
    userId: 'user_1',
    status: 'completed',
    r2Key: `users/user_1/outputs/${id}/image.png`,
    sizeBytes: 42,
  })
  const output = await service.get({ outputId: id, userId: 'user_1' })
  assert.equal(output?.status, 'completed')
  assert.equal(output?.sizeBytes, 42)
  assert.equal(output?.url, `/api/v1/files/${id}/content`)
})

test('OutputService retains project ownership on generated outputs', async () => {
  const { service, rows } = fixture()
  const id = await service.create({
    userId: 'user_1',
    projectId: 'project_1',
    type: 'image',
    source: 'image_generation',
    status: 'pending',
    prompt: 'project diagram',
    modelId: 'image/model',
    fileName: 'diagram.png',
  })

  assert.equal(rows.get(id)?.projectId, 'project_1')
})

test('OutputService applies shorter sandbox retention and owner-scoped deletion', async () => {
  const { deleted, service } = fixture()
  const before = Date.now()
  const id = await service.create({
    userId: 'user_1',
    type: 'document',
    source: 'sandbox',
    status: 'completed',
    prompt: 'export report',
    modelId: 'daytona/default',
    fileName: 'report.pdf',
  })
  const output = await service.get({ outputId: id, userId: 'user_1' })
  assert.ok((output?.expiresAt ?? 0) >= before + 24 * 60 * 60_000)
  assert.equal(await service.get({ outputId: id, userId: 'other' }), null)
  await assert.rejects(service.delete({ outputId: id, userId: 'other' }))
  await service.delete({ outputId: id, userId: 'user_1' })
  assert.deepEqual(deleted, [id])
})
