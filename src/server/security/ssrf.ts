import 'server-only'

import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { isDevelopmentRuntime } from '@/server/env/server-env'

type ValidationOptions = {
  allowLocalDev?: boolean
  requireHttps?: boolean
}

const UNSAFE_NETWORKS = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  UNSAFE_NETWORKS.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  UNSAFE_NETWORKS.addSubnet(network, prefix, 'ipv6')
}

export function isLocalNetworkHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal'
}

export function isUnsafeNetworkAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return UNSAFE_NETWORKS.check(address, 'ipv4')
  if (family === 6) return UNSAFE_NETWORKS.check(address, 'ipv6')
  return true
}

export async function validatePublicNetworkUrl(
  raw: unknown,
  options: ValidationOptions = {},
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'URL is required' }
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch (_error) {
    return { ok: false, error: 'Invalid URL' }
  }

  const isDevLocalAllowed =
    options.allowLocalDev === true &&
    isDevelopmentRuntime() &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]' || parsed.hostname === '::1')

  if (options.requireHttps !== false && parsed.protocol !== 'https:' && !isDevLocalAllowed) {
    return { ok: false, error: 'HTTPS required in production. HTTP is allowed only for local development.' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only HTTP and HTTPS URLs are supported' }
  }
  if (isDevLocalAllowed) return { ok: true, url: parsed }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL credentials are not allowed' }
  }
  if (isLocalNetworkHostname(parsed.hostname)) return { ok: false, error: 'Local and metadata hostnames are not allowed' }

  const literalFamily = isIP(parsed.hostname)
  if (literalFamily !== 0) {
    return isUnsafeNetworkAddress(parsed.hostname)
      ? { ok: false, error: 'Private, loopback, link-local, and metadata IPs are not allowed' }
      : { ok: false, error: 'IP literal URLs are not allowed' }
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(parsed.hostname, { all: true, verbatim: false })
  } catch (_error) {
    return { ok: false, error: 'Could not resolve URL hostname' }
  }
  if (addresses.length === 0) return { ok: false, error: 'Could not resolve URL hostname' }
  if (addresses.some((entry) => isUnsafeNetworkAddress(entry.address))) {
    return { ok: false, error: 'URL resolves to a private or local network address' }
  }
  return { ok: true, url: parsed }
}
