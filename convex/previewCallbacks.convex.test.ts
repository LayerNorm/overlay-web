import { afterEach, expect, test, vi } from 'vitest'
import { appCallbackHeaders, fetchAppCallback } from './lib/appCallback'
import { deliveryEnabled, requireDeliveryDestination } from './lib/previewDelivery'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

test('Preview callback credentials reach only the exact canonical app and retain service authentication', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://pr-123.preview.getoverlay.io')
  vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'test-bypass')
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  await fetchAppCallback('https://pr-123.preview.getoverlay.io/api/internal', {
    method: 'POST', headers: { 'x-overlay-service-auth': 'test-signature' }, body: '{}',
  })
  const init = fetchSpy.mock.calls[0][1]!
  expect(new Headers(init.headers).get('x-vercel-protection-bypass')).toBe('test-bypass')
  expect(new Headers(init.headers).get('x-overlay-service-auth')).toBe('test-signature')
  expect(init.redirect).toBe('error')
  for (const url of ['https://getoverlay.io/api/internal', 'https://pr-124.preview.getoverlay.io/api/internal',
    'https://pr-123.preview.getoverlay.io.evil.test/', 'https://user:pass@pr-123.preview.getoverlay.io/']) {
    expect(() => appCallbackHeaders(url)).toThrow('own PR app')
  }
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', '')
  expect(() => appCallbackHeaders('https://pr-123.preview.getoverlay.io/')).toThrow('hosting access')
})

test('Production callback headers do not acquire Preview hosting credentials', () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'production')
  vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'test-bypass')
  expect(appCallbackHeaders('https://getoverlay.io/').has('x-vercel-protection-bypass')).toBe(false)
})

test('Preview outbound delivery requires exact test recipients and HTTPS webhook origins', () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('OVERLAY_PREVIEW_EMAIL_RECIPIENTS', '')
  vi.stubEnv('OVERLAY_PREVIEW_WEBHOOK_ORIGINS', '')
  expect(deliveryEnabled('email')).toBe(false)
  expect(() => requireDeliveryDestination('email', 'other@example.test')).toThrow()
  vi.stubEnv('OVERLAY_PREVIEW_EMAIL_RECIPIENTS', ' qa@example.test ')
  vi.stubEnv('OVERLAY_PREVIEW_WEBHOOK_ORIGINS', 'https://hooks.example.test')
  expect(deliveryEnabled('email')).toBe(true)
  expect(() => requireDeliveryDestination('email', 'QA@example.test')).not.toThrow()
  expect(() => requireDeliveryDestination('webhook', 'https://hooks.example.test/fixture')).not.toThrow()
  for (const url of ['http://hooks.example.test/', 'https://hooks.example.test.evil.test/', 'https://user:pass@hooks.example.test/']) {
    expect(() => requireDeliveryDestination('webhook', url)).toThrow()
  }
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'production')
  expect(() => requireDeliveryDestination('email', 'normal@example.test')).not.toThrow()
})
