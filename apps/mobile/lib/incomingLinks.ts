const HOSTS = new Set(['getoverlay.io', 'www.getoverlay.io'])
const SECTIONS = new Set([
  'memories',
  'members',
  'models',
  'billing',
  'notifications',
  'voice',
  'account',
  'help',
])

export async function activateLinkWorkspace(
  target: unknown,
  active: string | null,
  switchWorkspace: (id: string) => Promise<void>,
): Promise<boolean> {
  if (typeof target !== 'string' || !target.trim() || target.length > 256 || target === active)
    return false
  await switchWorkspace(target)
  return true
}

export function incomingRoute(value: string, development = false): string {
  if (development && value === 'overlay://dev/shared-markdown') return '/dev/shared-markdown'
  try {
    const url = new URL(value, 'https://www.getoverlay.io')
    if (url.protocol !== 'overlay:' && (url.protocol !== 'https:' || !HOSTS.has(url.hostname)))
      return '/'
    const incomingPath =
      url.protocol === 'overlay:' && url.host ? `/${url.host}${url.pathname}` : url.pathname
    const path = incomingPath.replace(/^\/app(?=\/)/, '').replace(/^\/agents\//, '/agent/')
    if (path === '/dictate') return '/voice?autoEnable=1'
    if (path === '/auth/mcp-callback') return '/tools'
    if (/^\/auth\/(?:native\/callback|callback|transfer)$/.test(path)) return path + url.search
    const invite = /^\/(?:app\/)?invitations\/([A-Za-z0-9_-]+)$/.exec(path)
    if (invite) return `/invitations/${invite[1]}${url.search}`
    if (/^\/share\/c\/[A-Za-z0-9_-]+$/.test(path)) return path + url.search
    const settings = /^\/settings\/([a-z-]+)$/.exec(path)
    if (settings && SECTIONS.has(settings[1])) {
      url.searchParams.set('section', settings[1])
      return `/settings?${url.searchParams}`
    }
    const automation = /^\/automations\/([A-Za-z0-9_-]+)$/.exec(path)
    if (automation) {
      url.searchParams.set('id', automation[1])
      return `/automations?${url.searchParams}`
    }
    if (
      /^\/(?:work|agents|chat|files|automations|settings|activity|search)$/.test(path) ||
      /^\/(?:work|agent|dm|chat|channel|thread|note)\/[A-Za-z0-9_-]+$/.test(path) ||
      /^\/files\/(?:file|output|memory)\/[A-Za-z0-9_-]+$/.test(path)
    )
      return path + url.search
    return '/'
  } catch {
    return '/'
  }
}
