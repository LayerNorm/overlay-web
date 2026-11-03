import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { start } from 'workflow/api'
import { harnessSafeYieldFixture } from './harness-safe-yield-fixture'

vi.mock('server-only', () => ({}))
vi.mock('../../src/server/harness/state-steps', () => ({ readHarnessState: vi.fn() }))

async function persist(id: string, receiptId: string) {
  const directory = join(tmpdir(), 'harness-safe-yield')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${id}.json`), JSON.stringify({ receiptId }))
}

test('compiled step serialization recovers a safe yield only for its persisted receipt', async () => {
  const matching = randomUUID()
  await persist(matching, 'model:4')
  const recovered = await start(harnessSafeYieldFixture, [{ id: matching }])
  await expect(recovered.returnValue).resolves.toEqual({ recovered: true, modelCall: 5 })

  const forged = randomUUID()
  await persist(forged, 'model:5')
  const rejected = await start(harnessSafeYieldFixture, [{ id: forged }])
  await expect(rejected.returnValue).rejects.toThrow('HARNESS_SAFE_RESOURCE_PAUSE:model:4')
})
