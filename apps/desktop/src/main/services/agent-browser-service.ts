/**
 * AgentBrowserService — per-task offscreen BrowserWindows for agent automation.
 *
 * This window is NEVER shown to the user. It exists solely for agent-driven browsing.
 * Using offscreen: true ensures capturePage() / executeJavaScript() work regardless
 * of app visibility or compositor state — no GPU compositing dependency.
 *
 * All operations carry a hard 15-second timeout so a frozen webContents can never
 * stall the agent loop indefinitely — yields an error result instead.
 *
 * The user-visible BrowserManager / WebContentsView is completely independent.
 */

import { BrowserWindow, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getGroundedPageContent,
  groundedClick,
  groundedType,
  formatPageContentForAgent,
  formatClickResultForAgent,
  formatTypeResultForAgent
} from './agent/grounding/grounded-tools'
import {
  assertPublicHttpDestination,
  isNonPublicIp
} from './security/network-destination-policy'

const TOOL_TIMEOUT_MS = 15_000
const LOG_TAG = '[AgentBrowserService]'

const MAX_SCREENSHOT_BYTES = 4.5 * 1024 * 1024

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${LOG_TAG} Timeout after ${TOOL_TIMEOUT_MS / 1000}s: ${label}`
              )
            ),
          TOOL_TIMEOUT_MS
        )
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function validateUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `Unsupported protocol "${parsed.protocol}" — only http/https are allowed`
    }
    return null
  } catch {
    return `Invalid URL: ${url}`
  }
}

export class AgentBrowserService {
  private readonly windows = new Map<string, BrowserWindow>()
  private readonly taskRoots = new Map<string, string>()
  private readonly boundaryReadiness = new Map<string, Promise<void>>()

  // ── Window lifecycle ───────────────────────────────────────────────────────

  private getWindow(taskId: string): BrowserWindow {
    assertTaskId(taskId)
    const existing = this.windows.get(taskId)
    if (!existing || existing.isDestroyed()) {
      console.log(`${LOG_TAG} Creating ephemeral offscreen browser for task ${taskId}`)
      const taskWindow = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: {
          offscreen: true,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          // No "persist:" prefix: cookies, storage, cache, and service workers
          // exist only for this task and are destroyed with the window.
          partition: `overlay-agent-${taskId}-${randomUUID()}`
        }
      })
      this.windows.set(taskId, taskWindow)
      this.boundaryReadiness.set(taskId, this.configureTaskBoundary(taskId, taskWindow))

      taskWindow.webContents.on('did-start-loading', () => {
        console.log(
          `${LOG_TAG} [headless] Page loading started — ${taskWindow.webContents.getURL()}`
        )
      })

      taskWindow.webContents.on('did-stop-loading', () => {
        console.log(
          `${LOG_TAG} [headless] Page loading finished — ${taskWindow.webContents.getURL()}`
        )
      })

      taskWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
        console.error(
          `${LOG_TAG} [headless] Load failed (${code} ${desc}) — URL: ${url}`
        )
      })

      taskWindow.on('closed', () => {
        console.log(`${LOG_TAG} Ephemeral browser destroyed for task ${taskId}`)
        if (this.windows.get(taskId) === taskWindow) this.windows.delete(taskId)
      })

      console.log(
        `${LOG_TAG} Ephemeral browser ready (id: ${taskWindow.id}, offscreen: true)`
      )
    }
    return this.windows.get(taskId)!
  }

  private configureTaskBoundary(taskId: string, taskWindow: BrowserWindow): Promise<void> {
    const { webContents } = taskWindow
    const taskSession = webContents.session

    taskSession.setPermissionRequestHandler((_requestingContents, _permission, callback) => {
      callback(false)
    })
    taskSession.setPermissionCheckHandler(() => false)
    taskSession.on('will-download', (event, item) => {
      event.preventDefault()
      item.cancel()
    })
    taskSession.webRequest.onBeforeRequest((details, callback) => {
      if (isContainedPageResource(details.url)) {
        callback({ cancel: false })
        return
      }
      void this.assertTaskDestination(taskSession, details.url)
        .then(() => callback({ cancel: false }))
        .catch(() => {
          console.warn(`${LOG_TAG} Blocked non-public task request: ${details.url}`)
          callback({ cancel: true })
        })
    })
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    webContents.on('will-navigate', (event, targetUrl) => {
      try {
        const parsed = new URL(targetUrl)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') event.preventDefault()
      } catch {
        event.preventDefault()
      }
    })
    webContents.on('will-redirect', (event, targetUrl) => {
      try {
        const parsed = new URL(targetUrl)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') event.preventDefault()
      } catch {
        event.preventDefault()
      }
    })
    webContents.on('render-process-gone', () => {
      void this.destroyTask(taskId)
    })
    return taskSession.setProxy({ mode: 'direct' })
  }

  private async assertTaskDestination(taskSession: Session, input: string): Promise<URL> {
    const url = await assertPublicHttpDestination(input)
    const result = await taskSession.resolveHost(url.hostname, {
      cacheUsage: 'allowed'
    })
    if (
      result.endpoints.length === 0 ||
      result.endpoints.some(({ address }) => isNonPublicIp(address))
    ) {
      throw new Error('network_destination_forbidden')
    }
    return url
  }

  /** Expose webContents for grounded-tools consumers (e.g. grounded-tools.ts). */
  getWebContents(taskId: string): Electron.WebContents {
    return this.getWindow(taskId).webContents
  }

  /** Current URL loaded in the headless browser. */
  getURL(taskId: string): string {
    const taskWindow = this.windows.get(taskId)
    if (!taskWindow || taskWindow.isDestroyed()) return ''
    return taskWindow.webContents.getURL()
  }

  getTaskDownloadDirectory(taskId: string): string {
    assertTaskId(taskId)
    let taskRoot = this.taskRoots.get(taskId)
    if (!taskRoot) {
      taskRoot = mkdtempSync(join(tmpdir(), `overlay-agent-${taskId.slice(0, 20)}-`))
      this.taskRoots.set(taskId, taskRoot)
    }
    const downloadDirectory = join(taskRoot, 'downloads')
    mkdirSync(downloadDirectory, { recursive: true, mode: 0o700 })
    return downloadDirectory
  }

  // ── Operations with 15s timeout ────────────────────────────────────────────

  async navigate(taskId: string, url: string): Promise<string> {
    try {
      await assertPublicHttpDestination(url)
    } catch {
      const error = validateUrl(url) ?? 'Private, local, credentialed, or unsupported destination'
      console.warn(`${LOG_TAG} [headless] navigate blocked: ${error}`)
      return JSON.stringify({ success: false, error })
    }

    const taskWindow = this.getWindow(taskId)
    await this.boundaryReadiness.get(taskId)
    await this.assertTaskDestination(taskWindow.webContents.session, url)
    const wc = taskWindow.webContents
    console.log(`${LOG_TAG} [headless] navigate → ${url}`)

    await withTimeout(
      (async () => {
        await wc.loadURL(url)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      })(),
      `navigate(${url})`
    )

    const finalUrl = wc.getURL()
    console.log(`${LOG_TAG} [headless] navigate complete — current URL: ${finalUrl}`)
    return JSON.stringify({ success: true, url: finalUrl })
  }

  async getPageContent(taskId: string, taskIntent?: string): Promise<string> {
    const wc = this.getWindow(taskId).webContents
    const currentUrl = wc.getURL()
    console.log(
      `${LOG_TAG} [headless] getPageContent — URL: ${currentUrl}, intent: ${taskIntent ?? 'none'}`
    )

    const result = await withTimeout(
      getGroundedPageContent(wc, taskIntent),
      `getPageContent(${currentUrl})`
    )

    console.log(
      `${LOG_TAG} [headless] getPageContent done — ${result.elements.length} elements, hasPopup: ${result.hasPopup}`
    )
    return formatPageContentForAgent(result)
  }

  async click(taskId: string, target: string, taskIntent?: string): Promise<string> {
    const wc = this.getWindow(taskId).webContents
    console.log(`${LOG_TAG} [headless] click → target="${target}"`)

    const result = await withTimeout(
      groundedClick(wc, target, {
        taskIntent,
        verify: true,
        checkAdversarial: true
      }),
      `click(${target})`
    )

    const resultStr = formatClickResultForAgent(result)
    console.log(
      `${LOG_TAG} [headless] click result: ${resultStr.slice(0, 200)}`
    )
    return resultStr
  }

  async type(
    taskId: string,
    target: string,
    text: string,
    options: { pressEnter?: boolean; submit?: boolean } = {}
  ): Promise<string> {
    const wc = this.getWindow(taskId).webContents
    console.log(
      `${LOG_TAG} [headless] type → target="${target}", text="${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`
    )

    const result = await withTimeout(
      groundedType(wc, target, text, {
        submit: options.pressEnter ?? options.submit ?? false,
        verify: true
      }),
      `type(${target})`
    )

    const resultStr = formatTypeResultForAgent(result)
    console.log(
      `${LOG_TAG} [headless] type result: ${resultStr.slice(0, 200)}`
    )
    return resultStr
  }

  async scroll(
    taskId: string,
    direction: 'up' | 'down' | 'top' | 'bottom',
    amount = 500
  ): Promise<string> {
    const wc = this.getWindow(taskId).webContents
    console.log(
      `${LOG_TAG} [headless] scroll → direction="${direction}", amount=${amount}px`
    )

    const scrollMap: Record<string, string> = {
      down: `window.scrollBy(0, ${amount})`,
      up: `window.scrollBy(0, -${amount})`,
      top: `window.scrollTo(0, 0)`,
      bottom: `window.scrollTo(0, document.body.scrollHeight)`
    }
    const script = `(function() { ${scrollMap[direction] ?? scrollMap.down}; return JSON.stringify({ success: true }); })()`

    const result = await withTimeout(
      wc.executeJavaScript(script),
      `scroll(${direction})`
    )
    return typeof result === 'string' ? result : JSON.stringify(result)
  }

  async screenshot(taskId: string): Promise<string> {
    const wc = this.getWindow(taskId).webContents
    const currentUrl = wc.getURL()
    console.log(`${LOG_TAG} [headless] screenshot — URL: ${currentUrl}`)

    const image = await withTimeout(
      wc.capturePage(),
      `screenshot(${currentUrl})`
    )

    let quality = 90
    let buffer = image.toJPEG(quality)
    let scale = 1.0

    while (buffer.length > MAX_SCREENSHOT_BYTES && (quality > 20 || scale > 0.25)) {
      if (quality > 30) {
        quality -= 15
      } else if (scale > 0.25) {
        scale -= 0.25
        quality = 80
        const size = image.getSize()
        const resized = image.resize({
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
          quality: 'good'
        })
        buffer = resized.toJPEG(quality)
        continue
      } else {
        quality -= 10
      }
      buffer = image.toJPEG(quality)
    }

    const base64 = buffer.toString('base64')
    console.log(
      `${LOG_TAG} [headless] screenshot captured — ${buffer.length} bytes, quality: ${quality}, URL: ${currentUrl}`
    )
    return `data:image/jpeg;base64,${base64}`
  }

  async destroyTask(taskId: string): Promise<void> {
    const taskWindow = this.windows.get(taskId)
    if (taskWindow) {
      this.windows.delete(taskId)
      this.boundaryReadiness.delete(taskId)
      try {
        await taskWindow.webContents.session.clearStorageData()
        await taskWindow.webContents.session.clearCache()
      } catch {
        // The in-memory partition still disappears when its final window closes.
      }
      if (!taskWindow.isDestroyed()) taskWindow.destroy()
    }
    const taskRoot = this.taskRoots.get(taskId)
    if (taskRoot) {
      this.taskRoots.delete(taskId)
      rmSync(taskRoot, { recursive: true, force: true })
    }
  }

  async destroyAll(): Promise<void> {
    const taskIds = new Set([...this.windows.keys(), ...this.taskRoots.keys()])
    await Promise.allSettled([...taskIds].map((taskId) => this.destroyTask(taskId)))
  }
}

function assertTaskId(taskId: string): void {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(taskId)) throw new Error('invalid_agent_browser_task')
}

function isContainedPageResource(input: string): boolean {
  try {
    return ['about:', 'blob:', 'data:'].includes(new URL(input).protocol)
  } catch {
    return false
  }
}

// Task windows are created lazily after app readiness.
export const agentBrowserService = new AgentBrowserService()
