const id = (slug: string) => `k17conv${slug}`.padEnd(32, '0')
/** A new Atlas thread: nothing chosen yet. */
export const NEW_THREAD_ID = id('atlaslocalnew')
/** An Atlas thread that runs on this computer. */
export const LOCAL_THREAD_ID = id('atlaslocalcheckout')

/** Which app the mockup shows: the web app in a browser, or the desktop app with its bridge. */
export type Host = 'web' | 'desktop'
/** Whether this computer has connected and has folders yet. */
export type Setup = 'first' | 'done'

// The app's own address lives in the hash; these switches are in the real query string, read once at load.
const params = new URLSearchParams(globalThis.location?.search ?? '')
export const HOST: Host = params.get('host') === 'web' ? 'web' : 'desktop'
export const SETUP: Setup = params.get('setup') === 'done' ? 'done' : 'first'

/** The desktop bridge exists from the first render, so switching reloads the page. */
export function switchTo(next: { host?: Host; setup?: Setup }) {
  const query = new URLSearchParams(globalThis.location.search)
  query.set('host', next.host ?? HOST)
  query.set('setup', next.setup ?? SETUP)
  globalThis.location.href = `${globalThis.location.pathname}?${query.toString()}${globalThis.location.hash}`
}
