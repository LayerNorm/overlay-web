import { NextResponse, type NextRequest } from 'next/server'
import { INTEGRATIONS_BC_CHANNEL, INTEGRATIONS_STORAGE_KEY } from '@/shared/integrations/integrations-events'

/**
 * Where the provider tab lands after connector sign-in. Static HTML with no app shell, so it renders at once: it tells
 * the original Overlay tab the connection changed (BroadcastChannel, with a localStorage ping as fallback) and closes
 * itself. Browsers refuse window.close() after some providers isolate the tab, so the page also says it can be closed.
 */

const STYLE = `
:root { --background: #fafafa; --foreground: #0a0a0a; --muted: #71717a; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --background: #09090b; --foreground: #f5f5f5; --muted: #a1a1aa; } }
html, body { height: 100%; margin: 0; }
body { display: flex; align-items: center; justify-content: center; background: var(--background); color: var(--foreground); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
main { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 24px; max-width: 360px; }
h1 { margin: 0; font-size: 15px; font-weight: 500; }
p { margin: 0; color: var(--muted); font-size: 13px; }
`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function notifyScript(): string {
  const channel = JSON.stringify(INTEGRATIONS_BC_CHANNEL)
  const key = JSON.stringify(INTEGRATIONS_STORAGE_KEY)
  return `try{var b=new BroadcastChannel(${channel});b.postMessage({type:'changed'});b.close()}catch(e){}try{localStorage.setItem(${key},String(Date.now()))}catch(e){}setTimeout(function(){window.close()},600)`
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const error = params.get('error')
  const success = params.get('status') === 'success' && !error
  const nonce = request.headers.get('x-nonce')
  const title = success ? 'Connected' : 'Connection failed'
  const detail = success
    ? 'You can close this tab. Overlay has already updated.'
    : error ? escapeHtml(error.slice(0, 200)) : 'Close this tab and try connecting again from Overlay.'
  const script = success ? `<script${nonce ? ` nonce="${escapeHtml(nonce)}"` : ''}>${notifyScript()}</script>` : ''
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Overlay</title><style>${STYLE}</style></head><body><main><h1>${title}</h1><p>${detail}</p></main>${script}</body></html>`
  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
