import 'server-only'

/** Client IP for audit records. Only trusts proxy headers when running behind
 * a real proxy (Vercel sets x-vercel-forwarded-for; VERCEL env is present). */
export function getClientIp(request: Pick<Request, 'headers'>): string {
  const trustProxyHeaders =
    process.env.TRUST_PROXY_HEADERS === 'true' ||
    Boolean(process.env.VERCEL || process.env.CF_PAGES || process.env.CLOUDFLARE_ACCOUNT_ID)
  if (!trustProxyHeaders) return 'unknown'

  const candidates = [
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim(),
    request.headers.get('cf-connecting-ip')?.trim(),
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    request.headers.get('x-real-ip')?.trim(),
  ]
  return candidates.find((value) => Boolean(value)) || 'unknown'
}

export function requestOrigin(request: Request): string {
  return new URL(request.url).origin
}
