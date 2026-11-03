import { HarnessYield, runHarnessModelInvocation } from '../../src/server/harness/model-recovery'

async function throwYield(receiptId: string): Promise<never> {
  'use step'
  throw new HarnessYield(receiptId)
}

async function confirmPersisted(id: string, receiptId: string): Promise<boolean> {
  'use step'
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const record = JSON.parse(await readFile(join(tmpdir(), 'harness-safe-yield', `${id}.json`), 'utf8')) as { receiptId: string }
  return record.receiptId === receiptId
}

export async function harnessSafeYieldFixture(input: { id: string }) {
  'use workflow'
  const result = await runHarnessModelInvocation(
    () => throwYield('model:4'),
    () => ({ messages: [], steps: [], preparedReceiptId: 'model:4', modelCall: 4 }),
    () => [],
    undefined,
    receiptId => confirmPersisted(input.id, receiptId),
  )
  return { recovered: result.recovered, modelCall: result.modelCall }
}
