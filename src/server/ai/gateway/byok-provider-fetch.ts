import 'server-only'

import { lookup } from 'node:dns/promises'
import type { LookupAddress, LookupAllOptions } from 'node:dns'
import type { LookupFunction } from 'node:net'
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici'
// The socket guard deliberately reuses the canonical SSRF address policy.
// eslint-disable-next-line no-restricted-imports -- security policy facade for outbound provider traffic
import {
  isLocalNetworkHostname,
  isUnsafeNetworkAddress,
} from '@/server/security/ssrf'

const MAX_PROVIDER_RESPONSE_BYTES = 25_000_000

export class ByokProviderFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ByokProviderFetchError'
  }
}

export function assertPublicProviderAddresses(
  hostname: string,
  addresses: readonly LookupAddress[],
): void {
  if (isLocalNetworkHostname(hostname)) {
    throw new ByokProviderFetchError('Local and metadata hostnames are not allowed')
  }
  if (addresses.length === 0) {
    throw new ByokProviderFetchError('Could not resolve provider hostname')
  }
  if (addresses.some(({ address }) => isUnsafeNetworkAddress(address))) {
    throw new ByokProviderFetchError('Provider hostname resolved to a private or local network address')
  }
}

function createPublicNetworkLookup(): LookupFunction {
  return (hostname, options, callback) => {
    const lookupOptions: LookupAllOptions = {
      all: true,
      family: options.family,
      hints: options.hints,
      order: 'verbatim',
    }
    lookup(hostname, lookupOptions)
      .then((addresses) => {
        assertPublicProviderAddresses(hostname, addresses)
        if (options.all) {
          callback(null, addresses)
          return
        }
        const first = addresses[0]
        callback(null, first.address, first.family)
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new ByokProviderFetchError('Provider DNS lookup failed'), '')
      })
  }
}

// DNS validation happens inside the connector lookup used for the socket. This
// pins the connection to the addresses that were checked and prevents a DNS
// rebinding change between a preflight lookup and the actual request.
const providerDispatcher = new Agent({
  connect: {
    lookup: createPublicNetworkLookup(),
  },
  connectTimeout: 10_000,
  headersTimeout: 60_000,
  bodyTimeout: 300_000,
  keepAliveMaxTimeout: 30_000,
  maxResponseSize: MAX_PROVIDER_RESPONSE_BYTES,
  connections: 10,
  clientTtl: 60_000,
  maxOrigins: 100,
})

function normalizeRequestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input)
}

export function assertByokProviderRequestUrl(
  baseEndpoint: string,
  input: string | URL | Request,
): URL {
  const base = new URL(baseEndpoint)
  const target = new URL(normalizeRequestUrl(input))
  const basePath = base.pathname.replace(/\/+$/, '')
  const pathIsWithinBase =
    basePath === '' ||
    basePath === '/' ||
    target.pathname === basePath ||
    target.pathname.startsWith(`${basePath}/`)

  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.origin !== base.origin ||
    !pathIsWithinBase
  ) {
    throw new ByokProviderFetchError('Provider request escaped the configured API base URL')
  }
  return target
}

/**
 * Fetch implementation for OpenAI-compatible provider traffic.
 *
 * Requests are confined to the configured HTTPS origin and base path,
 * redirects are rejected, DNS is checked at socket-connect time, and response
 * size/time limits bound resource consumption without buffering model streams.
 */
export function createByokProviderFetch(baseEndpoint: string): typeof fetch {
  // Fail closed at construction if persisted data has somehow bypassed the API
  // endpoint validator.
  assertByokProviderRequestUrl(baseEndpoint, baseEndpoint)

  return async (input, init) => {
    const target = assertByokProviderRequestUrl(baseEndpoint, input)
    const requestInit = {
      ...(init as UndiciRequestInit | undefined),
      redirect: 'error' as const,
      dispatcher: providerDispatcher,
    }
    return await undiciFetch(target, requestInit) as unknown as Response
  }
}
