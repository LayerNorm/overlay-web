import assert from 'node:assert/strict'
import test from 'node:test'
import { ESLint } from 'eslint'
import path from 'node:path'

test('root restrictions preserve component/server and standalone app boundaries', async () => {
  const root = path.resolve(import.meta.dirname, '../../../..')
  const eslint = new ESLint({ cwd: root })
  for (const [file, source, rule] of [
    ['src/components/BoundaryReviewProbe.tsx', "import { secret } from '@/server/auth/private'\nexport const value = secret", 'no-restricted-imports'],
    ['src/components/BoundaryReviewProbe.tsx', "import { secret } from '../../apps/admin/src/server/env'\nexport const value = secret", 'app-separation/imports'],
    ['src/features/chat/components/BoundaryReviewProbe.tsx', "import { value } from '@/features/files/private'\nexport { value }", 'no-restricted-imports'],
  ]) {
    const [result] = await eslint.lintText(source, { filePath: path.join(root, file) })
    assert.ok(result.messages.some((message) => message.ruleId === rule), JSON.stringify(result.messages))
  }
})
