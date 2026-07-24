import { describe, expect, it } from 'vitest'
import {
  assertPublicHttpDestination,
  assertSafeExternalUrl,
  isNonPublicIp
} from './network-destination-policy'

describe('network destination policy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1'
  ])('blocks non-public address %s', (address) => {
    expect(isNonPublicIp(address)).toBe(true)
  })

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])(
    'permits public address %s',
    (address) => {
      expect(isNonPublicIp(address)).toBe(false)
    }
  )

  it('rejects external URL schemes, credentials, private destinations, and encoded newlines', async () => {
    await expect(assertSafeExternalUrl('file:///etc/passwd')).rejects.toThrow()
    await expect(assertSafeExternalUrl('https://user:pass@example.com')).rejects.toThrow()
    await expect(assertSafeExternalUrl('https://127.0.0.1/account')).rejects.toThrow()
    await expect(
      assertSafeExternalUrl('mailto:test@example.com?body=%0aBcc:attacker@example.com')
    ).rejects.toThrow()
  })

  it('permits bounded mail links and local development only when explicitly enabled', async () => {
    await expect(assertSafeExternalUrl('mailto:security@example.com')).resolves.toMatchObject({
      protocol: 'mailto:'
    })
    await expect(assertSafeExternalUrl('http://localhost:3000/account')).rejects.toThrow()
    await expect(
      assertSafeExternalUrl('http://localhost:3000/account', {
        allowLocalDevelopment: true
      })
    ).resolves.toMatchObject({ origin: 'http://localhost:3000' })
  })

  it('allows public HTTP browsing but rejects credentials, private hosts, and unusual ports', async () => {
    await expect(assertPublicHttpDestination('http://1.1.1.1/path')).resolves.toMatchObject({
      protocol: 'http:'
    })
    await expect(assertPublicHttpDestination('http://127.0.0.1/path')).rejects.toThrow()
    await expect(assertPublicHttpDestination('http://2130706433/path')).rejects.toThrow()
    await expect(assertPublicHttpDestination('http://0x7f000001/path')).rejects.toThrow()
    await expect(assertPublicHttpDestination('http://user@example.com/path')).rejects.toThrow()
    await expect(assertPublicHttpDestination('https://1.1.1.1:8443/path')).rejects.toThrow()
  })
})
