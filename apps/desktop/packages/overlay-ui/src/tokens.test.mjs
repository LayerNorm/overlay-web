import assert from 'node:assert/strict'
import test from 'node:test'

const { overlayDesignTokens, overlayTailwindTheme } = await import('./tokens.ts')

test('overlay ui exposes design tokens and a Tailwind-compatible theme', () => {
  assert.equal(overlayDesignTokens.colors.background, 'var(--background)')
  assert.equal(overlayDesignTokens.spacing[4], '1rem')
  assert.equal(overlayTailwindTheme.colors.background, 'var(--background)')
  assert.equal(overlayTailwindTheme.borderRadius.lg, '0.75rem')
})
