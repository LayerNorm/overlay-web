import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

test('interactive application modules do not retain showcase fixtures or bypasses', () => {
  const roots = ['src/features', 'src/components', 'src/contexts', 'src/app/app']
  const violations: string[] = []
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (/\.tsx?$/.test(file) && !/\.test\./.test(file)) {
        if (/showcase|useSeededGuestData|seededChats|conversationSnapshots/i.test(readFileSync(file, 'utf8'))) {
          violations.push(file)
        }
      }
    }
  }
  roots.forEach(visit)
  assert.deepEqual(violations, [])
})
