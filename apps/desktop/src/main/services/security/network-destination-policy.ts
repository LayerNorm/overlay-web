import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.aws.internal'
])

export async function assertSafeExternalUrl(
  input: string,
  options: { allowLocalDevelopment?: boolean } = {}
): Promise<URL> {
  if (typeof input !== 'string' || input.length > 4096 || /%0[ad]/i.test(input)) {
    throw new Error('invalid_external_url')
  }
  const url = new URL(input)
  if (url.protocol === 'mailto:') {
    if (!url.pathname || url.username || url.password || url.hash) {
      throw new Error('invalid_external_url')
    }
    return url
  }
  const localDevelopmentUrl =
    options.allowLocalDevelopment === true &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    !url.username &&
    !url.password
  if (localDevelopmentUrl) return url
  return assertPublicHttpsDestination(input)
}

export async function assertPublicHttpsDestination(input: string): Promise<URL> {
  const url = await assertPublicHttpDestination(input)
  if (url.protocol !== 'https:') throw new Error('network_destination_forbidden')
  return url
}

export async function assertPublicHttpDestination(input: string): Promise<URL> {
  return (await resolvePublicHttpDestination(input)).url
}

export interface ResolvedPublicHttpDestination {
  url: URL
  address: string
  family: 4 | 6
}

export async function resolvePublicHttpDestination(
  input: string
): Promise<ResolvedPublicHttpDestination> {
  if (typeof input !== 'string' || input.length > 8192) throw new Error('invalid_network_url')
  const url = new URL(input)
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    !url.hostname ||
    (url.port &&
      !(
        (url.protocol === 'https:' && url.port === '443') ||
        (url.protocol === 'http:' && url.port === '80')
      ))
  ) {
    throw new Error('network_destination_forbidden')
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('network_destination_forbidden')
  }

  if (isIP(hostname)) {
    if (isNonPublicIp(hostname)) throw new Error('network_destination_forbidden')
    return { url, address: hostname, family: isIP(hostname) as 4 | 6 }
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isNonPublicIp(address))) {
    throw new Error('network_destination_forbidden')
  }
  const selected = addresses[0]
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new Error('network_destination_forbidden')
  }
  return { url, address: selected.address, family: selected.family }
}

export function isNonPublicIp(input: string): boolean {
  const normalized = input.toLowerCase().split('%')[0] || ''
  if (normalized.includes(':')) return isNonPublicIpv6(normalized)
  const octets = normalized.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return true
  }
  const [a, b, c] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function isNonPublicIpv6(input: string): boolean {
  if (input === '::' || input === '::1') return true
  if (input.startsWith('::ffff:')) {
    const mapped = input.slice('::ffff:'.length)
    if (mapped.includes('.')) return isNonPublicIp(mapped)
    const words = mapped.split(':')
    if (words.length === 2) {
      const high = Number.parseInt(words[0] || '', 16)
      const low = Number.parseInt(words[1] || '', 16)
      if (Number.isFinite(high) && Number.isFinite(low)) {
        return isNonPublicIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
      }
    }
    return true
  }
  const first = Number.parseInt(input.split(':')[0] || '0', 16)
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast ff00::/8
    input.startsWith('2001:db8:') || // documentation
    input.startsWith('2001:10:') || // ORCHID
    input.startsWith('2001:2:') // benchmarking
  )
}
