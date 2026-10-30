import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('brand entry points import in React Server Component mode without the UI barrel', () => {
  const result = spawnSync(process.execPath, [
    '--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e',
    `
      import { BrandLockup } from './src/components/brand/BrandLockup.tsx'
      import { OverlayMark } from './src/components/brand/OverlayMark.tsx'
      if (typeof BrandLockup !== 'function' || typeof OverlayMark !== 'function') process.exit(1)
    `,
  ], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr || result.stdout)
})
