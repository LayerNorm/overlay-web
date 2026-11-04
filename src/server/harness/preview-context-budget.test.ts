import { expect, test } from 'vitest'
import { previewHarnessContextBudget } from './preview-context-budget'

const env = {
  VERCEL_ENV: 'preview', OVERLAY_DEPLOYMENT_ENV: 'preview',
  NEXT_PUBLIC_APP_URL: 'https://pr-384.preview.getoverlay.io',
  VERCEL_GIT_PULL_REQUEST_ID: '384', PREVIEW_LOGIN_USER_ID: 'user_qa',
  HARNESS_PREVIEW_CONTEXT_TOKENS: '16000',
}

test('lowers the working-context budget only for the provisioned Preview owner', () => {
  expect(previewHarnessContextBudget(env, 'user_qa')).toBe(16_000)
  expect(previewHarnessContextBudget(env, 'user_other')).toBeUndefined()
  expect(previewHarnessContextBudget(env)).toBeUndefined()
})

test('ignores the QA control outside the exact isolated Preview origin', () => {
  for (const overrides of [
    { VERCEL_ENV: 'production' }, { OVERLAY_DEPLOYMENT_ENV: 'production' },
    { NEXT_PUBLIC_APP_URL: 'https://getoverlay.io' }, { VERCEL_GIT_PULL_REQUEST_ID: '382' },
  ]) expect(previewHarnessContextBudget({ ...env, ...overrides }, 'user_qa')).toBeUndefined()
})

test('requires an explicit bounded integer and otherwise retains the normal budget', () => {
  for (const value of ['', '0', '8191', '32001', '-8192', '16000.5', 'Infinity']) {
    expect(previewHarnessContextBudget({ ...env, HARNESS_PREVIEW_CONTEXT_TOKENS: value }, 'user_qa')).toBeUndefined()
  }
})
