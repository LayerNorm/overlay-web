import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { LocalToolFailure } from './local-tools-errors.js'

/**
 * Drives a dedicated Chrome profile over the DevTools protocol on loopback.
 * The profile belongs to Overlay (not the user's everyday profile), keeps its
 * sign-ins between runs, and is visible on the user's screen. Actions and
 * results match the cloud Computer browser driver.
 */
export const RISKY_CLICK_NAME = /\b(post|tweet|reply|repost|send|publish|share|buy|pay|purchase|order|checkout|delete|remove|confirm|submit|subscribe|unsubscribe|follow|unfollow|transfer)\b/i
const START_TIMEOUT_MS = 15_000

const MAC_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]
const LINUX_BROWSERS = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']

type Target = { id: string; type: string; url: string; title: string; webSocketDebuggerUrl?: string }

export class CdpConnection {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>()
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown>; error?: { message?: string } }
      if (message.id === undefined) return
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new LocalToolFailure('desktop_driver_failed', `The browser rejected the action: ${message.error.message ?? 'unknown error'}`))
      else waiter.resolve(message.result ?? {})
    })
    socket.addEventListener('close', () => {
      for (const waiter of this.pending.values()) waiter.reject(new LocalToolFailure('desktop_driver_failed', 'The browser connection closed.'))
      this.pending.clear()
    })
  }

  static async open(url: string): Promise<CdpConnection> {
    if (!/^ws:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(url)) throw new LocalToolFailure('desktop_driver_failed', 'The browser debugging address is not local.')
    const socket = new WebSocket(url)
    await new Promise<void>((resolvePromise, reject) => {
      socket.addEventListener('open', () => resolvePromise(), { once: true })
      socket.addEventListener('error', () => reject(new LocalToolFailure('desktop_driver_failed', 'The browser could not be reached.')), { once: true })
    })
    return new CdpConnection(socket)
  }

  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new LocalToolFailure('desktop_driver_failed', `The browser did not answer ${method}.`)) }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolvePromise(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close(): void { this.socket.close() }
}

const SNAPSHOT_EXPRESSION = `(() => {
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
      && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth;
  };
  const elements = [...document.querySelectorAll('a[href],button,input,textarea,select,[role],[tabindex],[contenteditable="true"]')]
    .filter(visible).slice(0, 200).map(element => {
      let ref = element.getAttribute('data-overlay-ref');
      if (!ref || !/^overlay-[0-9]+$/.test(ref)) {
        window.__overlayRefCounter = (window.__overlayRefCounter || 0) + 1;
        ref = 'overlay-' + window.__overlayRefCounter;
        element.setAttribute('data-overlay-ref', ref);
      }
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute('aria-label')
        || [...(element.labels || [])].map(label => label.innerText || '').join(' ').trim()
        || element.getAttribute('title') || element.getAttribute('placeholder') || element.innerText || element.value || '';
      return {
        ref, role: element.getAttribute('role') || element.tagName.toLowerCase(), name: String(label).trim().slice(0, 300),
        bbox: {
          x: Math.max(0, Math.round(rect.left)), y: Math.max(0, Math.round(rect.top)),
          width: Math.max(0, Math.round(Math.min(innerWidth, rect.right) - Math.max(0, rect.left))),
          height: Math.max(0, Math.round(Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)))
        }
      };
    });
  return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 20000), elements };
})()`

const CLICK_INSPECTION = "const tag = element.tagName.toLowerCase(); "
  + "const type = String(element.getAttribute('type') || (tag === 'button' ? element.type : '') || '').trim().toLowerCase(); "
  + "const accessibleName = element.getAttribute('aria-label') || [...(element.labels || [])].map(label => label.innerText || '').join(' ').trim() "
  + "|| element.innerText || element.textContent || element.getAttribute('value') || element.value || ''; "
  + "return { role: element.getAttribute('role') || tag, tag, type, name: String(accessibleName).trim(), "
  + "isSubmit: (tag === 'button' || tag === 'input') && type === 'submit' && Boolean(element.closest('form')) };"

function refExpression(ref: unknown, body: string): string {
  if (typeof ref !== 'string' || !/^overlay-[0-9]+$/.test(ref)) throw new LocalToolFailure('invalid_input', 'ref must come from the latest browser snapshot.')
  return `(() => { const element = document.querySelector('[data-overlay-ref=' + JSON.stringify(${JSON.stringify(ref)}) + ']'); `
    + `if (!element) return { __overlayError: 'stale_browser_ref' }; ${body} })()`
}

function browserUrl(value: unknown): string {
  try {
    const url = new URL(String(value))
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return url.toString()
  } catch (_error) { /* fall through */ }
  throw new LocalToolFailure('invalid_input', 'url must be an HTTP or HTTPS URL.')
}

const KEYS: Record<string, [string, number]> = {
  Enter: ['Enter', 13], Tab: ['Tab', 9], Escape: ['Escape', 27], ArrowUp: ['ArrowUp', 38],
  ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], PageDown: ['PageDown', 34],
}

export class LocalBrowser {
  private port?: number
  private starting?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly profileDirectory: string, private readonly fetcher: typeof fetch = fetch) {}

  static async findBinary(): Promise<string | null> {
    for (const path of process.platform === 'darwin' ? MAC_BROWSERS : LINUX_BROWSERS) {
      try { await access(path, constants.X_OK); return path } catch (_error) { /* next */ }
    }
    return null
  }

  private async json<T>(path: string, method = 'GET'): Promise<T | null> {
    if (!this.port) return null
    try {
      const response = await this.fetcher(`http://127.0.0.1:${this.port}${path}`, { method, signal: AbortSignal.timeout(2_000) })
      return response.ok ? await response.json() as T : null
    } catch (_error) { return null }
  }

  private async readActivePort(): Promise<number | undefined> {
    const value = await readFile(join(this.profileDirectory, 'DevToolsActivePort'), 'utf8').catch(() => '')
    const port = Number.parseInt(value.split('\n')[0] ?? '', 10)
    return Number.isInteger(port) && port > 0 ? port : undefined
  }

  /** Starts the Overlay browser profile when it is not already running. */
  async ensure(): Promise<{ success: true; browser: string }> {
    if (!this.port) this.port = await this.readActivePort()
    if (await this.json('/json/version')) return { success: true, browser: 'chrome' }
    this.starting ??= this.start().finally(() => { this.starting = undefined })
    await this.starting
    return { success: true, browser: 'chrome' }
  }

  private async start(): Promise<void> {
    const binary = await LocalBrowser.findBinary()
    if (!binary) throw new LocalToolFailure('desktop_unsupported', 'Google Chrome is not installed on this Mac.', ['chrome'])
    await mkdir(this.profileDirectory, { recursive: true, mode: 0o700 })
    await rm(join(this.profileDirectory, 'DevToolsActivePort'), { force: true })
    const child = spawn(binary, [
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${this.profileDirectory}`,
      '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { detached: true, stdio: 'ignore' })
    child.unref()
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      this.port = await this.readActivePort()
      if (this.port && await this.json('/json/version')) return
      if (child.exitCode !== null) break
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
    }
    throw new LocalToolFailure('desktop_driver_failed', 'Chrome could not be started for Overlay.')
  }

  private async pages(): Promise<Target[]> {
    const targets = await this.json<Target[]>('/json/list')
    if (!Array.isArray(targets)) throw new LocalToolFailure('desktop_unsupported', 'The Overlay browser is unavailable.', ['chrome'])
    return targets.filter((target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
  }

  private async activePage(): Promise<Target> {
    const pages = await this.pages()
    if (pages[0]) return pages[0]
    const created = await this.json<Target>('/json/new?about:blank', 'PUT')
    if (!created?.webSocketDebuggerUrl) throw new LocalToolFailure('desktop_driver_failed', 'A browser page could not be created.')
    return created
  }

  private async activate(id: string): Promise<void> {
    if (!await this.json(`/json/activate/${encodeURIComponent(id)}`)) {
      // /json/activate answers with text, not JSON; confirm the target still exists instead.
      if (!(await this.pages()).some((page) => page.id === id)) throw new LocalToolFailure('desktop_driver_failed', 'The browser page could not be activated.')
    }
  }

  private async withPage<T>(work: (connection: CdpConnection, page: Target) => Promise<T>, page?: Target): Promise<T> {
    const target = page ?? await this.activePage()
    const connection = await CdpConnection.open(target.webSocketDebuggerUrl!)
    try { return await work(connection, target) } finally { connection.close() }
  }

  private static async evaluate(connection: CdpConnection, expression: string): Promise<unknown> {
    const result = await connection.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new LocalToolFailure('desktop_driver_failed', 'The browser page action failed.')
    const value = (result.result as { value?: unknown } | undefined)?.value
    if (value && typeof value === 'object' && (value as Record<string, unknown>).__overlayError === 'stale_browser_ref') {
      throw new LocalToolFailure('stale_browser_ref',
        'The page changed and this element reference expired. No action was taken. Take a new browser snapshot, then use its current ref. Do not retry the old ref or guess a replacement.')
    }
    return value
  }

  private static async key(connection: CdpConnection, key: unknown): Promise<void> {
    const entry = typeof key === 'string' ? KEYS[key] : undefined
    if (!entry) throw new LocalToolFailure('invalid_input', 'keys must be Enter, Tab, Escape, an arrow, or PageDown.')
    const base = { key, code: entry[0], windowsVirtualKeyCode: entry[1], nativeVirtualKeyCode: entry[1] }
    await connection.call('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
    await connection.call('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /** Browser actions run one at a time, like the cloud driver's input lock. */
  run(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const work = this.queue.then(() => this.action(request))
    this.queue = work.catch(() => undefined)
    return work
  }

  private async action(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensure()
    const handler = BROWSER_ACTIONS[String(request.action)]
    if (!handler) throw new LocalToolFailure('invalid_input', 'Unsupported browser action.')
    return handler(this, request)
  }

  async navigate(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = browserUrl(request.url)
    const page = await this.activePage()
    await this.activate(page.id)
    await this.withPage((connection) => connection.call('Page.navigate', { url }), page)
    return { success: true }
  }

  history(step: -1 | 1): Promise<Record<string, unknown>> {
    return this.withPage(async (connection) => {
      const history = await connection.call('Page.getNavigationHistory') as { entries?: Array<{ id: number }>; currentIndex?: number }
      const destination = (history.currentIndex ?? -1) + step
      const entry = history.entries?.[destination]
      if (destination < 0 || !entry) return { success: true, navigated: false }
      await connection.call('Page.navigateToHistoryEntry', { entryId: entry.id })
      return { success: true, navigated: true }
    })
  }

  async reload(): Promise<Record<string, unknown>> {
    await this.withPage((connection) => connection.call('Page.reload', { ignoreCache: false }))
    return { success: true }
  }

  async snapshot(): Promise<Record<string, unknown>> {
    const value = await this.withPage((connection) => LocalBrowser.evaluate(connection, SNAPSHOT_EXPRESSION))
    if (!value || typeof value !== 'object') throw new LocalToolFailure('desktop_driver_failed', 'The browser snapshot was invalid.')
    return value as Record<string, unknown>
  }

  click(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withPage(async (connection) => {
      const info = await LocalBrowser.evaluate(connection, refExpression(request.ref, CLICK_INSPECTION)) as Record<string, unknown> | null
      if (!info || typeof info !== 'object') throw new LocalToolFailure('desktop_driver_failed', 'The browser click target could not be inspected.')
      const name = String(info.name ?? '').trim()
      if (request.confirm !== true && (info.isSubmit === true || RISKY_CLICK_NAME.test(name))) {
        return {
          success: false, error: 'approval_required', label: name.slice(0, 80),
          message: 'This click may post, send, buy, or delete something. Call computer_browser click again with confirm: true to ask the user for approval.',
        }
      }
      await LocalBrowser.evaluate(connection, refExpression(request.ref, 'element.click(); return true;'))
      return { success: true }
    })
  }

  async type(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof request.text !== 'string' || request.text.length > 10_000) throw new LocalToolFailure('invalid_input', 'text must contain at most 10000 characters.')
    await this.withPage(async (connection) => {
      await LocalBrowser.evaluate(connection, refExpression(request.ref, 'element.focus(); return true;'))
      await connection.call('Input.insertText', { text: request.text })
      if (request.submit === true) await LocalBrowser.key(connection, 'Enter')
    })
    return { success: true }
  }

  async scroll(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const offsets = SCROLL_OFFSETS[String(request.direction)]
    const amount = request.amount
    if (!offsets) throw new LocalToolFailure('invalid_input', 'direction must be up, down, left, or right.')
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 25) throw new LocalToolFailure('invalid_input', 'amount must be between 1 and 25.')
    await this.withPage((connection) => LocalBrowser.evaluate(connection,
      `window.scrollBy({left: innerWidth * ${offsets[0] * amount}, top: innerHeight * ${offsets[1] * amount}, behavior: 'instant'}); true`))
    return { success: true }
  }

  async press(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.withPage((connection) => LocalBrowser.key(connection, request.keys))
    return { success: true }
  }

  async tabs(): Promise<Record<string, unknown>> {
    return { tabs: (await this.pages()).slice(0, 50).map((page, index) => ({ index, url: page.url, title: page.title })) }
  }

  async switchTab(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const index = request.index
    const pages = await this.pages()
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= pages.length) throw new LocalToolFailure('invalid_input', 'index does not identify an open browser tab.')
    await this.activate(pages[index]!.id)
    return { success: true, index }
  }

  async newTab(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = browserUrl(request.url)
    const created = await this.json<Target>(`/json/new?${encodeURIComponent(url)}`, 'PUT')
    if (!created?.id) throw new LocalToolFailure('desktop_driver_failed', 'The browser tab could not be created.')
    await this.activate(created.id)
    return { success: true, targetId: created.id }
  }
}

const SCROLL_OFFSETS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

type BrowserAction = (browser: LocalBrowser, request: Record<string, unknown>) => Promise<Record<string, unknown>>
const BROWSER_ACTIONS: Record<string, BrowserAction> = {
  navigate: (browser, request) => browser.navigate(request),
  back: (browser) => browser.history(-1),
  forward: (browser) => browser.history(1),
  reload: (browser) => browser.reload(),
  snapshot: (browser) => browser.snapshot(),
  click: (browser, request) => browser.click(request),
  type: (browser, request) => browser.type(request),
  scroll: (browser, request) => browser.scroll(request),
  press: (browser, request) => browser.press(request),
  tabs: (browser) => browser.tabs(),
  switch_tab: (browser, request) => browser.switchTab(request),
  new_tab: (browser, request) => browser.newTab(request),
}
