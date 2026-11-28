import {
  CHROME_EXTENSION_ORIGIN,
  envelope,
  parseExtensionReply,
  type ChromeAppRequest,
  type ChromeExtensionReply,
  type ChromePage,
  type ChromePageContext,
} from '@overlay/chrome-bridge'

/** Where the Chrome side panel shows a signed-out person, instead of the guest app. */
export const CHROME_HOME_PATH = '/auth/chrome'

/** True when this page is the web app inside the Overlay Chrome extension's side panel. */
export function isChromeExtensionFrame(): boolean {
  if (typeof window === 'undefined' || window.parent === window) return false
  return window.location.ancestorOrigins?.[0] === CHROME_EXTENSION_ORIGIN
}

const REPLY_TIMEOUT_MS = 8_000

function ask<T extends ChromeExtensionReply['type']>(type: T): Promise<Extract<ChromeExtensionReply, { type: T }>> {
  if (!isChromeExtensionFrame()) return Promise.reject(new Error('Not in the Chrome side panel.'))
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const done = () => {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }
    const timer = window.setTimeout(() => {
      done()
      reject(new Error('The Chrome extension did not answer.'))
    }, REPLY_TIMEOUT_MS)
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== CHROME_EXTENSION_ORIGIN || event.source !== window.parent) return
      const reply = parseExtensionReply(event.data)
      if (reply?.type !== type || reply.id !== id) return
      done()
      resolve(reply as Extract<ChromeExtensionReply, { type: T }>)
    }
    window.addEventListener('message', onMessage)
    const request: ChromeAppRequest = { type, id }
    window.parent.postMessage(envelope(request), CHROME_EXTENSION_ORIGIN)
  })
}

/** The tab next to the side panel, or null on pages the extension cannot read (Chrome's own pages). */
export async function readCurrentChromePage(): Promise<ChromePage | null> {
  return (await ask('page.current')).page
}

/** The current tab's address, title, selection and visible text. */
export async function readChromePageContext(): Promise<ChromePageContext> {
  const reply = await ask('page.context')
  if (!reply.context) throw new Error(reply.error ?? 'Could not read this page.')
  return reply.context
}

/**
 * Starts a flow that leaves Overlay (checkout, billing portal, GitHub or Slack install). Those sites refuse to be
 * framed, so inside the Chrome side panel the flow opens in a new tab and returns there; elsewhere this page goes.
 */
export function navigateToExternalFlow(url: string): void {
  if (isChromeExtensionFrame()) {
    window.open(url, '_blank', 'noopener')
    return
  }
  window.location.assign(url)
}
