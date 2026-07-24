import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  mkdirSync,
  unlinkSync,
  writeFileSync,
  createWriteStream,
  readFileSync,
  readdirSync,
  statSync,
  openSync,
  copyFileSync,
  renameSync,
  rmSync
} from 'node:fs'
import { basename, join, resolve, sep, dirname, extname } from 'node:path'
import { homedir } from 'node:os'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import axios, { type AxiosResponse } from 'axios'
import { createHash } from 'node:crypto'
import { Composio } from '@composio/core'
import { windowManager } from '../window-manager'
import { panelManager } from '../panel-manager'
import { browserManager } from '../browser-manager'
import { getCloudMemoryService } from '../memory/CloudMemoryService'
import { getUnifiedKnowledgeService } from '../memory/UnifiedKnowledgeService'
import { runAxHelper } from './ax-bridge'
import { getComposioMetaTools, getConnectedToolkits, getUserId } from './composio-service'
import { keyCacheService } from '../key-cache-service'
import { auditLogger } from '../security/security-service'
import { terminalService } from '../terminal/terminal-service'
import { runtimeService } from '../runtime/runtime-service'
import { agentBrowserService } from '../agent-browser-service'
import {
  applyContainmentToolProfile,
  areChatAgentLocalCapabilitiesEnabled
} from '../security/containment-capability-profile'
import { assertEveryToolIsRegistered } from '../security/agent-policy/tool-registry'
import { secureAgentToolSet } from '../security/agent-policy/secure-agent-tools'
import { settingsService } from '../settings-service'
import { resolvePublicHttpDestination } from '../security/network-destination-policy'

const execFileAsync = promisify(execFile)

const MAX_TOOL_RESULT_CHARS = 8000
const USER_INPUT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const TOOL_TIMEOUT_MS = 30_000 // 30 s per-tool hard limit

const pendingUserInputRequests = new Map<string, () => void>()

export function resolveUserInputRequest(requestId: string): boolean {
  const resolve = pendingUserInputRequests.get(requestId)
  if (resolve) {
    resolve()
    pendingUserInputRequests.delete(requestId)
    return true
  }
  return false
}
const MAX_FIELD_CHARS = 800
const MAX_COMPOSIO_RESULT_CHARS = 30000
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 30000
const APPLESCRIPT_TIMEOUT_MS = 15000

type JsonRecord = Record<string, unknown>

export type AgentSurface = 'chat' | 'browser' | 'notebook' | 'voice'

export interface NotebookEdit {
  id: string
  description: string
  startLine: number
  endLine: number
  originalLines: string[]
  newLines: string[]
}

export interface ToolHooks {
  onToolStart?: (name: string, input: JsonRecord) => void
  onToolResult?: (name: string, result: string) => void
}

export interface NotebookToolContext {
  noteContent: string
  noteTitle: string
  mode: 'ask' | 'write'
  createEditId?: () => string
  onEditProposal?: (edit: NotebookEdit) => void
  onFinish?: (summary: string) => void
}

export interface BrowserToolHandlers {
  openBrowserUrl?: (args: { url: string }) => Promise<string>
  browserGetPageContent?: (args: { taskIntent?: string }) => Promise<string>
  browserClick?: (args: { target: string; taskIntent?: string }) => Promise<string>
  browserType?: (args: {
    target?: string
    selector?: string
    text: string
    pressEnter?: boolean
    submit?: boolean
    taskIntent?: string
  }) => Promise<string>
  browserScroll?: (args: {
    direction: 'up' | 'down' | 'top' | 'bottom'
    amount?: number
  }) => Promise<string>
  browserWait?: (args: { ms?: number }) => Promise<string>
  navigateBrowser?: (args: { url: string }) => Promise<string>
  browserScreenshot?: () => Promise<string>
  searchWeb?: (args: { query: string }) => Promise<string>
}

export interface ComposioToolOptions {
  includeMetaTools?: boolean
  allowRemoteTools?: boolean
  command?: string
}

export interface ToolSetOptions {
  surface: AgentSurface
  /** Main-generated security identity shared by approvals, grants, providers, and cleanup. */
  securityTaskId: string
  isCancelled?: () => boolean
  hooks?: ToolHooks
  notebookContext?: NotebookToolContext
  browserHandlers?: BrowserToolHandlers
  /** Handlers for the offscreen headless agent browser (AgentBrowserService). */
  headlessBrowserHandlers?: BrowserToolHandlers
  composio?: ComposioToolOptions
  includeCoreTools?: boolean
  includeBrowserTools?: boolean
  includeOsTools?: boolean
  includeTerminalTools?: boolean
  includeFileSystemTools?: boolean
  includeDirectComposioExecute?: boolean
  /** Whether the model supports vision (image input). When true, browser_screenshot returns image content parts and browser_click/browser_type include auto-screenshots. */
  supportsVision?: boolean
  /** Allowed directories for file system tools. Defaults to home directory. */
  fsAllowedDirs?: string[]
  /** User-selected working folder — used as default cwd and added to allowed dirs. */
  workingFolder?: string
  /** Include script execution tools (uv Python / Node.js). */
  includeScriptTools?: boolean
  /** Include memory tools. Disable for temporary or memory-off turns. */
  includeMemoryTools?: boolean
  /** When true, adds web search tool via AI Gateway. */
  searchEnabled?: boolean
  /** Gateway model ID to use for the inner web search generateText call. Defaults to a cheap fast model. */
  searchModelId?: string
  /** Include coding tools: code_edit_file, code_search_codebase, code_run_tests, code_git_*, code_lint */
  includeCodingTools?: boolean
}

function truncate(value: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`
}

function toToolResultString(value: unknown): string {
  if (typeof value === 'string') return truncate(value)
  try {
    return truncate(JSON.stringify(value))
  } catch {
    return truncate(String(value))
  }
}

function toToolInputRecord(input: unknown): JsonRecord {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as JsonRecord
  }
  return { value: input }
}

function emitToolStart(options: ToolSetOptions, name: string, input: JsonRecord): void {
  options.hooks?.onToolStart?.(name, input)
}

function emitToolResult(options: ToolSetOptions, name: string, result: unknown): void {
  options.hooks?.onToolResult?.(name, toToolResultString(result))
}

function auditSensitiveTool(action: string, details: JsonRecord, success: boolean): void {
  auditLogger.log({
    type: 'ipc:sensitive_call',
    action,
    details,
    success
  })
}

function shouldCancel(options: ToolSetOptions): boolean {
  return options.isCancelled?.() === true
}

async function runWithLifecycle<T>(
  options: ToolSetOptions,
  toolName: string,
  input: JsonRecord,
  executor: () => Promise<T>,
  timeoutMs: number = TOOL_TIMEOUT_MS
): Promise<T | JsonRecord> {
  if (shouldCancel(options)) {
    return { cancelled: true }
  }

  emitToolStart(options, toolName, input)
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    )
    const result = await Promise.race([executor(), timeoutPromise])
    emitToolResult(options, toolName, result)
    return result
  } catch (err) {
    const fallback = { success: false, error: err instanceof Error ? err.message : String(err) }
    emitToolResult(options, toolName, fallback)
    return fallback
  }
}

function getActiveTabWebContents(): Electron.WebContents | null {
  const browserWindow = windowManager.findWindowByType('browser')
  if (!browserWindow) return null
  return browserManager.getActiveTabWebContents(browserWindow.id)
}

async function ensureBrowserPanelSilent(): Promise<Electron.BrowserWindow | null> {
  const existing = windowManager.findWindowByType('browser')
  if (existing) return existing

  const created = panelManager.createPanelWindow('browser')
  if (!created) return null
  await new Promise((resolve) => setTimeout(resolve, 400))
  return created
}

async function ensureBrowserPanel(): Promise<Electron.BrowserWindow | null> {
  const existing = windowManager.findWindowByType('browser')
  if (existing) {
    // Don't force-show hidden panels; they render headlessly via WebContentsView
    return existing
  }

  const created = panelManager.createPanelWindow('browser')
  if (!created) return null
  created.show()
  created.focus()
  await new Promise((resolve) => setTimeout(resolve, 400))
  return created
}

const APPLESCRIPT_BLOCKED_PATTERNS = [
  /do\s+shell\s+script/i,
  /system\s+events.*keystroke/i,
  /system\s+events.*key\s+code/i,
  /«class\s+url\s*»/i,
  /open\s+location/i,
  /curl\s/i,
  /rm\s+-rf/i,
  /keychain/i,
  /security\s+(find|add|delete)-/i,
  /defaults\s+write/i,
  /LaunchAgents/i,
  /LaunchDaemons/i,
  /\.ssh/i,
  /\.gnupg/i
]

function validateAppleScript(script: string): { allowed: boolean; reason?: string } {
  for (const pattern of APPLESCRIPT_BLOCKED_PATTERNS) {
    if (pattern.test(script)) {
      return { allowed: false, reason: `Script contains blocked pattern: ${pattern.source}` }
    }
  }
  return { allowed: true }
}

async function runAppleScript(script: string, timeoutMs = APPLESCRIPT_TIMEOUT_MS): Promise<string> {
  const validation = validateAppleScript(script)
  if (!validation.allowed) {
    auditSensitiveTool('tool:applescript_run:blocked', { reason: validation.reason }, false)
    throw new Error(`AppleScript blocked: ${validation.reason}`)
  }

  const tmpPath = join(
    app.getPath('temp'),
    `overlay-as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.applescript`
  )
  const scriptHash = createHash('sha256').update(script).digest('hex').slice(0, 16)

  auditSensitiveTool(
    'tool:applescript_run:start',
    { scriptHash, scriptPreview: script.slice(0, 200), timeoutMs },
    true
  )

  writeFileSync(tmpPath, script, 'utf8')
  try {
    const { stdout, stderr } = await execFileAsync('osascript', [tmpPath], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    })
    const output = (stdout || stderr || '').trim()
    auditSensitiveTool(
      'tool:applescript_run:finish',
      { scriptHash, outputLength: output.length },
      true
    )
    return output
  } catch (err) {
    auditSensitiveTool(
      'tool:applescript_run:finish',
      {
        scriptHash,
        error: err instanceof Error ? err.message : String(err)
      },
      false
    )
    throw err
  } finally {
    try {
      unlinkSync(tmpPath)
    } catch {
      // ignore
    }
  }
}

function escapeForAppleScript(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getCurrentDateTimePayload(): JsonRecord {
  const now = new Date()
  return {
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    iso: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' })
  }
}

function jsClick(target: string): string {
  return `(function() {
    try {
      const bySel = document.querySelector(${JSON.stringify(target)});
      if (bySel) { bySel.click(); return JSON.stringify({ clicked: true, strategy: 'selector' }); }
    } catch (e) {}

    const interactive = document.querySelectorAll('a, button, [role="button"], [role="link"]');
    for (const el of interactive) {
      const text = (el.innerText || el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      if (text.toLowerCase().includes(${JSON.stringify(target.toLowerCase())}) || aria.toLowerCase().includes(${JSON.stringify(target.toLowerCase())})) {
        el.click();
        return JSON.stringify({ clicked: true, strategy: 'text', tag: el.tagName });
      }
    }

    return JSON.stringify({ clicked: false, error: 'Element not found' });
  })()`
}

const JS_GET_PAGE_CONTENT = `(function() {
  const url = location.href;
  const title = document.title;
  const bodyText = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 4000);
  const elements = [];
  const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"]';
  document.querySelectorAll(sel).forEach((el, i) => {
    if (i > 80) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const text = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().slice(0, 100);
    if (!text) return;
    elements.push({ tag: el.tagName.toLowerCase(), text });
  });
  return JSON.stringify({ url, title, bodyText, elements });
})()`

function jsScroll(direction: 'up' | 'down' | 'top' | 'bottom', amount: number): string {
  const scrollMap: Record<string, string> = {
    up: `window.scrollBy(0, -${amount})`,
    down: `window.scrollBy(0, ${amount})`,
    top: 'window.scrollTo(0, 0)',
    bottom: 'window.scrollTo(0, document.body.scrollHeight)'
  }
  return `(function() { ${scrollMap[direction] || scrollMap.down}; return JSON.stringify({ success: true }); })()`
}

const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:'])

function validateBrowserUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
      return `Blocked URL scheme "${parsed.protocol}" — only http: and https: are allowed`
    }
    return null
  } catch {
    return `Invalid URL: ${url}`
  }
}

async function defaultOpenBrowserUrl(url: string): Promise<string> {
  const schemeError = validateBrowserUrl(url)
  if (schemeError) {
    return JSON.stringify({ success: false, error: schemeError })
  }

  const panel = await ensureBrowserPanelSilent()
  if (!panel) {
    return JSON.stringify({ success: false, error: 'Could not open browser panel' })
  }
  const wc = browserManager.getActiveTabWebContents(panel.id)
  if (!wc) {
    return JSON.stringify({ success: false, error: 'No active tab' })
  }

  await wc.loadURL(url)
  return JSON.stringify({ success: true, url })
}

async function defaultBrowserGetPageContent(): Promise<string> {
  const wc = getActiveTabWebContents()
  if (!wc) return JSON.stringify({ success: false, error: 'Browser not open' })
  const result = await wc.executeJavaScript(JS_GET_PAGE_CONTENT)
  return typeof result === 'string' ? result : JSON.stringify(result)
}

async function defaultBrowserClick(target: string): Promise<string> {
  const wc = getActiveTabWebContents()
  if (!wc) return JSON.stringify({ success: false, error: 'Browser not open' })
  const result = await wc.executeJavaScript(jsClick(target))
  return typeof result === 'string' ? result : JSON.stringify(result)
}

async function defaultBrowserType(args: {
  target?: string
  selector?: string
  text: string
  pressEnter?: boolean
  submit?: boolean
}): Promise<string> {
  const wc = getActiveTabWebContents()
  if (!wc) return JSON.stringify({ success: false, error: 'Browser not open' })

  const target = args.target || args.selector
  const pressEnter = args.pressEnter ?? args.submit ?? false
  const js = `(function() {
    const el = ${
      target ? `document.querySelector(${JSON.stringify(target)})` : 'document.activeElement'
    };
    if (!el) return JSON.stringify({ success: false, error: 'No input element found' });
    el.focus();
    if ('value' in el) {
      el.value = ${JSON.stringify(args.text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    ${
      pressEnter
        ? `el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));`
        : ''
    }
    return JSON.stringify({ success: true });
  })()`

  const result = await wc.executeJavaScript(js)
  return typeof result === 'string' ? result : JSON.stringify(result)
}

async function defaultBrowserScroll(
  direction: 'up' | 'down' | 'top' | 'bottom',
  amount?: number
): Promise<string> {
  const wc = getActiveTabWebContents()
  if (!wc) return JSON.stringify({ success: false, error: 'Browser not open' })
  const result = await wc.executeJavaScript(jsScroll(direction, amount || 500))
  return typeof result === 'string' ? result : JSON.stringify(result)
}

async function defaultNavigateBrowser(url: string): Promise<string> {
  const schemeError = validateBrowserUrl(url)
  if (schemeError) {
    return JSON.stringify({ success: false, error: schemeError })
  }

  const wc = getActiveTabWebContents()
  if (!wc) return JSON.stringify({ success: false, error: 'Browser not open' })
  await wc.loadURL(url)
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return JSON.stringify({ success: true, url })
}

async function defaultBrowserScreenshot(): Promise<string> {
  const wc = getActiveTabWebContents()
  if (!wc) return JSON.stringify({ success: false, error: 'Browser not open' })

  const image = await wc.capturePage()
  const png = image.toPNG()
  return JSON.stringify({
    success: true,
    message: 'Screenshot captured',
    width: image.getSize().width,
    height: image.getSize().height,
    bytes: png.length
  })
}

async function defaultSearchWeb(query: string): Promise<string> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`
  return defaultOpenBrowserUrl(url)
}

// ── Headless browser defaults (AgentBrowserService) ───────────────────────────

async function defaultHeadlessNavigate(taskId: string, url: string): Promise<string> {
  console.log(`[UnifiedTools][headless] defaultHeadlessNavigate → ${url}`)
  return agentBrowserService.navigate(taskId, url)
}

async function defaultHeadlessGetPageContent(
  taskId: string,
  taskIntent?: string
): Promise<string> {
  console.log(
    `[UnifiedTools][headless] defaultHeadlessGetPageContent, intent: ${taskIntent ?? 'none'}`
  )
  return agentBrowserService.getPageContent(taskId, taskIntent)
}

async function defaultHeadlessClick(
  taskId: string,
  target: string,
  taskIntent?: string
): Promise<string> {
  console.log(`[UnifiedTools][headless] defaultHeadlessClick → "${target}"`)
  return agentBrowserService.click(taskId, target, taskIntent)
}

async function defaultHeadlessType(args: {
  taskId: string
  target?: string
  selector?: string
  text: string
  pressEnter?: boolean
  submit?: boolean
}): Promise<string> {
  const target = args.target || args.selector
  if (!target) return JSON.stringify({ success: false, error: 'Target selector is required' })
  console.log(
    `[UnifiedTools][headless] defaultHeadlessType → "${target}", text="${args.text.slice(0, 50)}"`
  )
  return agentBrowserService.type(args.taskId, target, args.text, {
    pressEnter: args.pressEnter ?? args.submit ?? false
  })
}

async function defaultHeadlessScroll(
  taskId: string,
  direction: 'up' | 'down' | 'top' | 'bottom',
  amount?: number
): Promise<string> {
  console.log(`[UnifiedTools][headless] defaultHeadlessScroll → ${direction}`)
  return agentBrowserService.scroll(taskId, direction, amount ?? 500)
}

async function defaultHeadlessScreenshot(taskId: string): Promise<string> {
  console.log(`[UnifiedTools][headless] defaultHeadlessScreenshot`)
  return agentBrowserService.screenshot(taskId)
}

function createEphemeralTaskBrowserHandlers(taskId: string): BrowserToolHandlers {
  return {
    openBrowserUrl: ({ url }) => agentBrowserService.navigate(taskId, url),
    navigateBrowser: ({ url }) => agentBrowserService.navigate(taskId, url),
    browserGetPageContent: ({ taskIntent }) =>
      agentBrowserService.getPageContent(taskId, taskIntent),
    browserClick: ({ target, taskIntent }) =>
      agentBrowserService.click(taskId, target, taskIntent),
    browserType: ({ target, selector, text, pressEnter, submit }) => {
      const effectiveTarget = target || selector
      if (!effectiveTarget) {
        return Promise.resolve(
          JSON.stringify({ success: false, error: 'Target selector is required' })
        )
      }
      return agentBrowserService.type(taskId, effectiveTarget, text, {
        pressEnter: pressEnter ?? submit ?? false
      })
    },
    browserScroll: ({ direction, amount }) =>
      agentBrowserService.scroll(taskId, direction, amount ?? 500),
    browserWait: async ({ ms }) => {
      const waitMs = Math.min(Math.max(ms ?? 1_000, 0), 10_000)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      return JSON.stringify({ success: true, waited: waitMs })
    },
    browserScreenshot: () => agentBrowserService.screenshot(taskId),
    searchWeb: ({ query }) =>
      agentBrowserService.navigate(
        taskId,
        `https://www.google.com/search?q=${encodeURIComponent(query)}`
      )
  }
}

function addHeadlessBrowserTools(tools: ToolSet, options: ToolSetOptions): void {
  tools.headless_navigate = tool({
    description:
      'Navigate the HEADLESS (invisible) agent browser to a URL and wait for page load. ' +
      'Use this for fully-automated browsing workflows that do NOT require user interaction. ' +
      'The user cannot see this browser.',
    inputSchema: z.object({
      url: z.string().describe('Full URL with protocol (e.g. https://example.com)')
    }),
    execute: async ({ url }) =>
      runWithLifecycle(options, 'headless_navigate', { url }, async () => {
        console.log(`[UnifiedTools][headless] tool: headless_navigate → ${url}`)
        const handler = options.headlessBrowserHandlers?.navigateBrowser
        return handler
          ? handler({ url })
          : defaultHeadlessNavigate(options.securityTaskId, url)
      })
  })

  tools.headless_get_page_content = tool({
    description:
      'Get DOM content and interactive elements from the HEADLESS agent browser. ' +
      'Call this after headless_navigate to read page text, links, and form fields.',
    inputSchema: z.object({
      taskIntent: z.string().optional().describe('Optional task context for element filtering')
    }),
    execute: async ({ taskIntent }) =>
      runWithLifecycle(options, 'headless_get_page_content', { taskIntent }, async () => {
        console.log(
          `[UnifiedTools][headless] tool: headless_get_page_content, intent: ${taskIntent ?? 'none'}`
        )
        const handler = options.headlessBrowserHandlers?.browserGetPageContent
        return handler
          ? handler({ taskIntent })
          : defaultHeadlessGetPageContent(options.securityTaskId, taskIntent)
      })
  })

  tools.headless_click = tool({
    description:
      'Click an element in the HEADLESS agent browser by CSS selector or visible text. ' +
      'Use grounded selectors from headless_get_page_content output.',
    inputSchema: z.object({
      target: z.string().describe('CSS selector or visible text to click'),
      taskIntent: z.string().optional().describe('Optional task context')
    }),
    execute: async ({ target, taskIntent }) => {
      if (shouldCancel(options)) return { cancelled: true }
      emitToolStart(options, 'headless_click', { target, taskIntent })
      console.log(`[UnifiedTools][headless] tool: headless_click → "${target}"`)
      try {
        const handler = options.headlessBrowserHandlers?.browserClick
        const result = handler
          ? await handler({ target, taskIntent })
          : await defaultHeadlessClick(options.securityTaskId, target, taskIntent)
        emitToolResult(options, 'headless_click', result)

        if (options.supportsVision && options.headlessBrowserHandlers?.browserScreenshot) {
          try {
            const screenshot = await options.headlessBrowserHandlers.browserScreenshot()
            if (screenshot.startsWith('data:image/')) {
              return [
                { type: 'text', text: result },
                { type: 'image', image: screenshot, mimeType: 'image/jpeg' }
              ]
            }
          } catch {
            // screenshot failure is non-fatal
          }
        }

        return result
      } catch (err) {
        const fallback = { success: false, error: err instanceof Error ? err.message : String(err) }
        emitToolResult(options, 'headless_click', fallback)
        return fallback
      }
    }
  })

  tools.headless_type = tool({
    description:
      'Type text into an input in the HEADLESS agent browser. ' +
      'Optionally press Enter/submit after typing.',
    inputSchema: z.object({
      text: z.string().describe('Text to type'),
      target: z.string().optional().describe('CSS selector or input hint'),
      selector: z.string().optional().describe('Alias of target'),
      pressEnter: z.boolean().optional().describe('Press Enter after typing'),
      submit: z.boolean().optional().describe('Alias of pressEnter'),
      taskIntent: z.string().optional().describe('Optional task context')
    }),
    execute: async ({ text, target, selector, pressEnter, submit }) => {
      if (shouldCancel(options)) return { cancelled: true }
      const input = { text, target, selector, pressEnter, submit }
      emitToolStart(options, 'headless_type', input)
      console.log(
        `[UnifiedTools][headless] tool: headless_type → target="${target ?? selector}", text="${text.slice(0, 50)}"`
      )
      try {
        const handler = options.headlessBrowserHandlers?.browserType
        const result = handler
          ? await handler(input)
          : await defaultHeadlessType({ taskId: options.securityTaskId, ...input })
        emitToolResult(options, 'headless_type', result)

        if (options.supportsVision && options.headlessBrowserHandlers?.browserScreenshot) {
          try {
            const screenshot = await options.headlessBrowserHandlers.browserScreenshot()
            if (screenshot.startsWith('data:image/')) {
              return [
                { type: 'text', text: result },
                { type: 'image', image: screenshot, mimeType: 'image/jpeg' }
              ]
            }
          } catch {
            // screenshot failure is non-fatal
          }
        }

        return result
      } catch (err) {
        const fallback = { success: false, error: err instanceof Error ? err.message : String(err) }
        emitToolResult(options, 'headless_type', fallback)
        return fallback
      }
    }
  })

  tools.headless_scroll = tool({
    description: 'Scroll the HEADLESS agent browser page.',
    inputSchema: z.object({
      direction: z.enum(['up', 'down', 'top', 'bottom']).describe('Scroll direction'),
      amount: z.number().optional().describe('Pixels to scroll (default 500)')
    }),
    execute: async ({ direction, amount }) =>
      runWithLifecycle(options, 'headless_scroll', { direction, amount }, async () => {
        console.log(`[UnifiedTools][headless] tool: headless_scroll → ${direction}`)
        const handler = options.headlessBrowserHandlers?.browserScroll
        return handler
          ? handler({ direction, amount })
          : defaultHeadlessScroll(options.securityTaskId, direction, amount)
      })
  })

  tools.headless_screenshot = tool({
    description:
      'Capture a screenshot from the HEADLESS agent browser. ' +
      'Returns an image for visual verification of headless page state.',
    inputSchema: z.object({}),
    execute: async () => {
      if (shouldCancel(options)) return { cancelled: true }
      emitToolStart(options, 'headless_screenshot', {})
      console.log(`[UnifiedTools][headless] tool: headless_screenshot`)
      try {
        const handler = options.headlessBrowserHandlers?.browserScreenshot
        const result = handler
          ? await handler()
          : await defaultHeadlessScreenshot(options.securityTaskId)

        if (options.supportsVision && result.startsWith('data:image/')) {
          emitToolResult(options, 'headless_screenshot', { type: 'screenshot', captured: true })
          return [
            { type: 'text', text: 'Headless screenshot captured.' },
            { type: 'image', image: result, mimeType: 'image/jpeg' }
          ]
        }

        emitToolResult(options, 'headless_screenshot', result)
        return result
      } catch (err) {
        const fallback = { success: false, error: err instanceof Error ? err.message : String(err) }
        emitToolResult(options, 'headless_screenshot', fallback)
        return fallback
      }
    }
  })
}

function sanitizeFilename(input: string): string {
  const base = basename((input || 'download').normalize('NFKC'))
  const safe = base
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 120)

  return safe || 'download'
}

function deriveFilename(urlStr: string): string {
  try {
    const parsed = new URL(urlStr)
    const fromPath = basename(parsed.pathname)
    if (fromPath && fromPath !== '/' && fromPath !== '.') {
      return sanitizeFilename(fromPath)
    }
  } catch {
    // ignore
  }

  return `download-${Date.now()}.bin`
}

async function downloadFileToTaskFolder(
  taskId: string,
  url: string,
  filename?: string
): Promise<JsonRecord> {
  const baseDir = agentBrowserService.getTaskDownloadDirectory(taskId)
  mkdirSync(baseDir, { recursive: true, mode: 0o700 })

  const finalName = sanitizeFilename(filename || deriveFilename(url))
  const targetPath = join(baseDir, finalName)

  const resolvedBase = resolve(baseDir)
  const resolvedTarget = resolve(targetPath)
  if (!(resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${sep}`))) {
    throw new Error('Invalid target path')
  }

  const { response, finalUrl } = await openPublicDownloadStream(url)

  const declaredLength = Number(response.headers['content-length'] || 0)
  if (declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File too large: ${declaredLength} bytes exceeds ${MAX_DOWNLOAD_BYTES}`)
  }

  let received = 0
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length
      if (received > MAX_DOWNLOAD_BYTES) {
        cb(new Error(`File exceeds ${MAX_DOWNLOAD_BYTES} bytes limit`))
        return
      }
      cb(null, chunk)
    }
  })

  let targetCreated = false
  try {
    const fileDescriptor = openSync(targetPath, 'wx', 0o600)
    targetCreated = true
    await pipeline(
      response.data,
      limiter,
      createWriteStream(targetPath, { fd: fileDescriptor, autoClose: true })
    )
  } catch (err) {
    if (targetCreated) {
      try {
        unlinkSync(targetPath)
      } catch {
        // ignore
      }
    }
    throw err
  }

  if (process.platform === 'darwin') {
    const quarantine = `0081;${Math.floor(Date.now() / 1000).toString(16)};Overlay;`
    await execFileAsync('/usr/bin/xattr', [
      '-w',
      'com.apple.quarantine',
      quarantine,
      targetPath
    ]).catch(() => undefined)
  }

  return {
    success: true,
    url,
    finalUrl,
    path: targetPath,
    fileName: finalName,
    bytes: received,
    contentType: response.headers['content-type'] || null
  }
}

async function openPublicDownloadStream(
  inputUrl: string
): Promise<{ response: AxiosResponse<Readable>; finalUrl: string }> {
  let currentUrl = inputUrl
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const validated = await resolvePublicHttpDestination(currentUrl)
    const pinnedLookup: import('node:net').LookupFunction = (_hostname, _options, callback) => {
      callback(null, validated.address, validated.family)
    }
    const response = await axios.get<Readable>(validated.url.toString(), {
      responseType: 'stream',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxBodyLength: MAX_DOWNLOAD_BYTES,
      maxRedirects: 0,
      proxy: false,
      httpAgent: new HttpAgent({ keepAlive: false, lookup: pinnedLookup }),
      httpsAgent: new HttpsAgent({ keepAlive: false, lookup: pinnedLookup }),
      validateStatus: (status) => status >= 200 && status < 400
    })
    if (response.status >= 200 && response.status < 300) {
      return { response, finalUrl: validated.url.toString() }
    }
    response.data?.destroy?.()
    const location = response.headers.location
    if (
      response.status < 300 ||
      response.status >= 400 ||
      typeof location !== 'string' ||
      redirectCount === 5
    ) {
      throw new Error('Download redirect rejected')
    }
    currentUrl = new URL(location, validated.url).toString()
  }
  throw new Error('Too many download redirects')
}

function truncateComposioResult(result: unknown): string {
  function truncateDeep(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.length > MAX_FIELD_CHARS ? `${value.slice(0, MAX_FIELD_CHARS)}...` : value
    }
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((entry) => truncateDeep(entry))
    }
    if (value && typeof value === 'object') {
      const record: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        record[key] = truncateDeep(entry)
      }
      return record
    }
    return value
  }

  const payload = JSON.stringify(truncateDeep(result))
  if (payload.length > MAX_COMPOSIO_RESULT_CHARS) {
    return `${payload.slice(0, MAX_COMPOSIO_RESULT_CHARS)}...`
  }
  return payload
}

async function executeComposioTool(toolName: string, input: JsonRecord): Promise<string> {
  const composioKey = await keyCacheService.getKey('composio')
  if (!composioKey) {
    return JSON.stringify({ success: false, error: 'Composio API key not available' })
  }

  try {
    const composio = new Composio({ apiKey: composioKey })
    const result = await composio.tools.execute(toolName, {
      userId: getUserId(),
      arguments: input,
      dangerouslySkipVersionCheck: true
    })
    return truncateComposioResult(result)
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

function resolveComposioSessionIdFactory(): {
  resolve: (toolName: string, args: JsonRecord) => string
} {
  let composioSessionId: string | null = null
  const fallbackSessionId = `overlay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const resolve = (toolName: string, args: JsonRecord): string => {
    const providedSessionId =
      typeof args.session_id === 'string' && args.session_id.trim().length > 0
        ? args.session_id.trim()
        : null

    const sessionObj =
      args.session && typeof args.session === 'object' && !Array.isArray(args.session)
        ? (args.session as JsonRecord)
        : null

    const providedSessionFromObject =
      typeof sessionObj?.id === 'string' && sessionObj.id.trim().length > 0
        ? sessionObj.id.trim()
        : null

    const provided = providedSessionId || providedSessionFromObject

    if (!composioSessionId) {
      composioSessionId = provided || fallbackSessionId
    } else if (provided && provided !== composioSessionId) {
      console.warn(
        `[UnifiedTools][Composio] Overriding mismatched session_id for ${toolName}: ${provided} -> ${composioSessionId}`
      )
    }

    return composioSessionId
  }

  return { resolve }
}

function withConsistentComposioSession(
  toolName: string,
  args: JsonRecord,
  resolver: (toolName: string, args: JsonRecord) => string
): JsonRecord {
  const sessionId = resolver(toolName, args)
  const normalized: JsonRecord = { ...args }

  if (toolName === 'COMPOSIO_SEARCH_TOOLS') {
    const existingSession =
      normalized.session &&
      typeof normalized.session === 'object' &&
      !Array.isArray(normalized.session)
        ? (normalized.session as JsonRecord)
        : {}

    normalized.session = {
      ...existingSession,
      id: sessionId
    }

    if (normalized.session && typeof normalized.session === 'object') {
      delete (normalized.session as JsonRecord).generate_id
    }

    return normalized
  }

  if (
    toolName === 'COMPOSIO_MANAGE_CONNECTIONS' ||
    toolName === 'COMPOSIO_MULTI_EXECUTE_TOOL' ||
    toolName === 'COMPOSIO_REMOTE_BASH_TOOL' ||
    toolName === 'COMPOSIO_REMOTE_WORKBENCH'
  ) {
    normalized.session_id = sessionId
  }

  return normalized
}

async function addComposioMetaTools(tools: ToolSet, options: ToolSetOptions): Promise<void> {
  const composioTools = (await getComposioMetaTools()) as Record<string, any>
  if (!composioTools || Object.keys(composioTools).length === 0) {
    return
  }

  // Remote workbench/shell availability is an explicit trusted configuration
  // decision. Model/user prompt keywords can never enable these tools.
  const allowRemote = options.composio?.allowRemoteTools === true

  if (!allowRemote) {
    delete composioTools.COMPOSIO_REMOTE_BASH_TOOL
    delete composioTools.COMPOSIO_REMOTE_WORKBENCH
  }

  const preConnected = getConnectedToolkits()
  if (preConnected.length > 0 && composioTools.COMPOSIO_MANAGE_CONNECTIONS) {
    const preConnectedSet = new Set(preConnected.map((toolkit) => toolkit.toLowerCase()))
    const original = composioTools.COMPOSIO_MANAGE_CONNECTIONS

    composioTools.COMPOSIO_MANAGE_CONNECTIONS = {
      ...original,
      execute: async (args: any, extra: any) => {
        const requestedToolkits = Array.isArray(args?.toolkits)
          ? args.toolkits
              .filter((toolkit: unknown): toolkit is string => typeof toolkit === 'string')
              .map((toolkit: string) => toolkit.toLowerCase())
          : []

        const hasSessionId =
          typeof args?.session_id === 'string' && args.session_id.trim().length > 0
        const reinitiateAll = Boolean(args?.reinitiate_all)
        const allRequestedPreConnected =
          requestedToolkits.length > 0 &&
          requestedToolkits.every((toolkit: string) => preConnectedSet.has(toolkit))

        if (allRequestedPreConnected && !hasSessionId && !reinitiateAll) {
          return JSON.stringify({
            already_connected: true,
            message:
              'This toolkit is already connected. Use COMPOSIO_SEARCH_TOOLS to find tools, then COMPOSIO_MULTI_EXECUTE_TOOL to execute them.'
          })
        }

        return original.execute?.(args, extra)
      }
    }
  }

  const { resolve } = resolveComposioSessionIdFactory()

  for (const [toolName, toolDef] of Object.entries(composioTools)) {
    if (!toolName.startsWith('COMPOSIO_')) continue
    if (!toolDef || typeof toolDef !== 'object') continue

    const originalExecute = toolDef.execute
    if (typeof originalExecute !== 'function') continue

    composioTools[toolName] = {
      ...toolDef,
      execute: async (args: any, extra: any) => {
        const normalizedArgs = withConsistentComposioSession(
          toolName,
          toToolInputRecord(args),
          resolve
        )

        emitToolStart(options, toolName, normalizedArgs)

        try {
          const result = await originalExecute(normalizedArgs, extra)
          emitToolResult(options, toolName, result)
          return result
        } catch (err) {
          const fallback = JSON.stringify({
            error: err instanceof Error ? err.message : String(err)
          })
          emitToolResult(options, toolName, fallback)
          throw err
        }
      }
    }
  }

  Object.assign(tools, composioTools)
}

function addCoreTools(tools: ToolSet, options: ToolSetOptions): void {
  if (options.includeMemoryTools ?? true) {
    tools.memory_search = tool({
      description: 'Search user memories. Always call this early for personalization.',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Maximum results (default 5)')
      }),
      execute: async ({ query, limit }) =>
        runWithLifecycle(options, 'memory_search', { query, limit }, async () => {
          const memoryService = getCloudMemoryService()
          const results = await memoryService.search(query, limit || 5)
          return {
            success: true,
            count: results.length,
            memories: results.map((entry) => ({
              content: entry.content,
              type: entry.type,
              score: entry.score
            }))
          }
        })
    })

    tools.memory_add = tool({
      description: 'Save important details to memory.',
      inputSchema: z.object({
        content: z.string().describe('Information to remember'),
        type: z.enum(['fact', 'preference', 'project', 'decision']).optional()
      }),
      execute: async ({ content, type }) =>
        runWithLifecycle(options, 'memory_add', { content, type }, async () => {
          const memoryService = getCloudMemoryService()
          await memoryService.addMemory({ content, type: type || 'fact' })
          return { success: true }
        })
    })
  }

  tools.overlay_notes_search = tool({
    description: 'Search Overlay notes semantically.',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Maximum results (default 5)')
    }),
    execute: async ({ query, limit }) =>
      runWithLifecycle(options, 'overlay_notes_search', { query, limit }, async () => {
        const knowledgeService = getUnifiedKnowledgeService()
        const results = await knowledgeService.search({
          query,
          includeMemories: false,
          includeDocuments: true,
          includeNotes: false,
          includeChats: false,
          limit: limit || 5
        })
        return {
          success: true,
          count: results.documents.length,
          notes: results.documents.slice(0, 10).map((entry) => ({
            noteId: entry.sourceId,
            title: entry.title,
            content: entry.content.slice(0, 300)
          }))
        }
      })
  })

  tools.get_current_time = tool({
    description: 'Get current date/time with timezone.',
    inputSchema: z.object({}),
    execute: async () =>
      runWithLifecycle(options, 'get_current_time', {}, async () => getCurrentDateTimePayload())
  })

  tools.request_user_input = tool({
    description:
      'Show the Overlay browser panel to the user and pause until they complete a required action (login, captcha, confirmation, or any interaction that requires a human). This is the ONLY way to surface the browser panel — never show it proactively for background tasks.',
    inputSchema: z.object({
      reason: z.string().describe('Why user input is needed (shown to the user)'),
      showBrowser: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether to show the browser panel (default true)')
    }),
    execute: async ({ reason, showBrowser }) =>
      runWithLifecycle(options, 'request_user_input', { reason, showBrowser }, async () => {
        if (showBrowser !== false) {
          const panel = await ensureBrowserPanel()
          if (panel && !panel.isDestroyed()) {
            panel.show()
            panel.focus()
          }
        }

        const requestId = `user-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        // Notify all renderer windows
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.webContents.isDestroyed()) {
            win.webContents.send('agent:user-input-request', { requestId, reason })
          }
        }

        // Wait for user to signal completion (or timeout)
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            pendingUserInputRequests.delete(requestId)
            reject(new Error(`User input timed out after ${USER_INPUT_TIMEOUT_MS / 60000} minutes`))
          }, USER_INPUT_TIMEOUT_MS)

          pendingUserInputRequests.set(requestId, () => {
            clearTimeout(timeoutId)
            resolve()
          })
        })

        return { success: true, message: 'User completed the required action' }
      })
  })
}

function addNotebookTools(tools: ToolSet, options: ToolSetOptions): void {
  const context = options.notebookContext

  tools.read_note = tool({
    description: 'Read note title and content with line numbers.',
    inputSchema: z.object({}),
    execute: async () =>
      runWithLifecycle(options, 'read_note', {}, async () => {
        const title = context?.noteTitle || 'Untitled'
        const content = context?.noteContent || ''
        const lines = content.split('\n')
        const numbered = lines.map((line, index) => `${index + 1}: ${line}`).join('\n')

        return {
          title,
          lineCount: lines.length,
          content: numbered,
          isEmpty: lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')
        }
      })
  })

  if (context?.mode === 'write') {
    tools.propose_edit = tool({
      description:
        'Propose replacing a line range with new content. User can accept/reject each edit.',
      inputSchema: z.object({
        description: z.string().describe('Short edit label'),
        start_line: z.number().describe('First line to replace (1-indexed)'),
        end_line: z.number().describe('Last line to replace (1-indexed, inclusive)'),
        new_content: z.string().describe('Replacement content; empty string deletes lines')
      }),
      execute: async ({ description, start_line, end_line, new_content }) =>
        runWithLifecycle(
          options,
          'propose_edit',
          { description, start_line, end_line, new_content },
          async () => {
            const content = context?.noteContent || ''
            const lines = content.split('\n')

            const startLine = Math.max(1, Math.round(start_line))
            const endLine = Math.max(startLine, Math.round(end_line))
            const originalLines = lines.slice(startLine - 1, endLine)
            const newLines = new_content === '' ? [] : new_content.split('\n')

            const edit: NotebookEdit = {
              id:
                context?.createEditId?.() ||
                `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              description,
              startLine,
              endLine,
              originalLines,
              newLines
            }

            context?.onEditProposal?.(edit)

            return {
              success: true,
              editId: edit.id,
              message: `Edit proposed (lines ${startLine}-${endLine})`
            }
          }
        )
    })
  }

  tools.finish = tool({
    description: 'Signal notebook task completion with a summary.',
    inputSchema: z.object({
      summary: z.string().describe('One-sentence summary')
    }),
    execute: async ({ summary }) =>
      runWithLifecycle(options, 'finish', { summary }, async () => {
        context?.onFinish?.(summary)
        return { success: true, summary }
      })
  })
}

function addBrowserTools(tools: ToolSet, options: ToolSetOptions): void {
  // Desktop chat never receives the user's persistent interactive browser
  // profile. Its browser tools use a disposable task partition instead.
  const browserHandlers =
    options.browserHandlers ??
    (options.surface === 'chat'
      ? createEphemeralTaskBrowserHandlers(options.securityTaskId)
      : undefined)

  tools.fetch_url_content = tool({
    description:
      'Fetch the text content of a URL. Opens the URL silently in the Overlay browser background, extracts page text, and returns it. Use this when the user asks about a specific URL or webpage.',
    inputSchema: z.object({
      url: z.string().describe('Full URL with protocol (e.g. https://example.com)')
    }),
    execute: async ({ url }) =>
      runWithLifecycle(options, 'fetch_url_content', { url }, async () => {
        const openResult = browserHandlers?.openBrowserUrl
          ? await browserHandlers.openBrowserUrl({ url })
          : await defaultOpenBrowserUrl(url)
        const parsed = JSON.parse(openResult)
        if (!parsed.success) {
          return JSON.stringify({ success: false, error: parsed.error || 'Failed to open URL' })
        }
        // Wait for page to load
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const content = browserHandlers?.browserGetPageContent
          ? await browserHandlers.browserGetPageContent({})
          : await defaultBrowserGetPageContent()
        return content
      })
  })

  tools.open_browser_url = tool({
    description: 'Open URL in Overlay browser panel.',
    inputSchema: z.object({
      url: z.string().describe('Full URL with protocol')
    }),
    execute: async ({ url }) =>
      runWithLifecycle(options, 'open_browser_url', { url }, async () => {
        const handler = browserHandlers?.openBrowserUrl
        return handler ? handler({ url }) : defaultOpenBrowserUrl(url)
      })
  })

  tools.browser_get_page_content = tool({
    description: 'Get current browser page content and interactive elements.',
    inputSchema: z.object({
      taskIntent: z.string().optional().describe('Optional task context')
    }),
    execute: async ({ taskIntent }) =>
      runWithLifecycle(options, 'browser_get_page_content', { taskIntent }, async () => {
        const handler = browserHandlers?.browserGetPageContent
        return handler ? handler({ taskIntent }) : defaultBrowserGetPageContent()
      })
  })

  tools.browser_click = tool({
    description: 'Click an element in browser by selector or visible text.',
    inputSchema: z.object({
      target: z.string().describe('Selector or text to click'),
      taskIntent: z.string().optional().describe('Optional task context')
    }),
    execute: async ({ target, taskIntent }) => {
      if (shouldCancel(options)) return { cancelled: true }
      emitToolStart(options, 'browser_click', { target, taskIntent })
      try {
        const handler = browserHandlers?.browserClick
        const result = handler
          ? await handler({ target, taskIntent })
          : await defaultBrowserClick(target)
        emitToolResult(options, 'browser_click', result)

        // Auto-screenshot after click so the model can verify the action visually
        if (options.supportsVision && browserHandlers?.browserScreenshot) {
          try {
            const screenshot = await browserHandlers.browserScreenshot()
            if (screenshot.startsWith('data:image/')) {
              return [
                { type: 'text', text: result },
                { type: 'image', image: screenshot, mimeType: 'image/jpeg' }
              ]
            }
          } catch {
            // screenshot failure is non-fatal
          }
        }

        return result
      } catch (err) {
        const fallback = { success: false, error: err instanceof Error ? err.message : String(err) }
        emitToolResult(options, 'browser_click', fallback)
        return fallback
      }
    }
  })

  tools.browser_type = tool({
    description: 'Type text into browser input.',
    inputSchema: z.object({
      text: z.string().describe('Text to type'),
      target: z.string().optional().describe('Selector or input hint'),
      selector: z.string().optional().describe('Alias of target selector'),
      pressEnter: z.boolean().optional().describe('Press Enter after typing'),
      submit: z.boolean().optional().describe('Alias of pressEnter'),
      taskIntent: z.string().optional().describe('Optional task context')
    }),
    execute: async ({ text, target, selector, pressEnter, submit, taskIntent }) => {
      if (shouldCancel(options)) return { cancelled: true }
      const input = { text, target, selector, pressEnter, submit, taskIntent }
      emitToolStart(options, 'browser_type', input)
      try {
        const handler = browserHandlers?.browserType
        const result = handler ? await handler(input) : await defaultBrowserType(input)
        emitToolResult(options, 'browser_type', result)

        // Auto-screenshot after typing so the model can verify the action visually
        if (options.supportsVision && browserHandlers?.browserScreenshot) {
          try {
            const screenshot = await browserHandlers.browserScreenshot()
            if (screenshot.startsWith('data:image/')) {
              return [
                { type: 'text', text: result },
                { type: 'image', image: screenshot, mimeType: 'image/jpeg' }
              ]
            }
          } catch {
            // screenshot failure is non-fatal
          }
        }

        return result
      } catch (err) {
        const fallback = { success: false, error: err instanceof Error ? err.message : String(err) }
        emitToolResult(options, 'browser_type', fallback)
        return fallback
      }
    }
  })

  tools.browser_scroll = tool({
    description: 'Scroll current browser page.',
    inputSchema: z.object({
      direction: z.enum(['up', 'down', 'top', 'bottom']).describe('Scroll direction'),
      amount: z.number().optional().describe('Pixels to scroll')
    }),
    execute: async ({ direction, amount }) =>
      runWithLifecycle(options, 'browser_scroll', { direction, amount }, async () => {
        const handler = browserHandlers?.browserScroll
        return handler ? handler({ direction, amount }) : defaultBrowserScroll(direction, amount)
      })
  })

  tools.browser_wait = tool({
    description: 'Wait for a specified duration in milliseconds.',
    inputSchema: z.object({
      ms: z.number().optional().describe('Milliseconds to wait')
    }),
    execute: async ({ ms }) =>
      runWithLifecycle(options, 'browser_wait', { ms }, async () => {
        const handler = browserHandlers?.browserWait
        if (handler) {
          return handler({ ms })
        }

        const waitMs = Math.min(ms || 1000, 10000)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        return JSON.stringify({ success: true, waited: waitMs })
      })
  })

  tools.navigate_browser = tool({
    description: 'Navigate active browser tab to URL.',
    inputSchema: z.object({
      url: z.string().describe('URL to navigate')
    }),
    execute: async ({ url }) =>
      runWithLifecycle(options, 'navigate_browser', { url }, async () => {
        const handler = browserHandlers?.navigateBrowser
        return handler ? handler({ url }) : defaultNavigateBrowser(url)
      })
  })

  tools.browser_screenshot = tool({
    description: 'Capture screenshot of active browser tab.',
    inputSchema: z.object({}),
    execute: async () => {
      if (shouldCancel(options)) return { cancelled: true }
      emitToolStart(options, 'browser_screenshot', {})
      try {
        const handler = browserHandlers?.browserScreenshot
        const result = handler ? await handler() : await defaultBrowserScreenshot()

        // For vision-capable models: return image content parts so the model can see the screenshot
        if (options.supportsVision && result.startsWith('data:image/')) {
          emitToolResult(options, 'browser_screenshot', { type: 'screenshot', captured: true })
          return [
            { type: 'text', text: 'Screenshot captured.' },
            { type: 'image', image: result, mimeType: 'image/jpeg' }
          ]
        }

        emitToolResult(options, 'browser_screenshot', result)
        return result
      } catch (err) {
        const fallback = { success: false, error: err instanceof Error ? err.message : String(err) }
        emitToolResult(options, 'browser_screenshot', fallback)
        return fallback
      }
    }
  })

  tools.search_web = tool({
    description: 'Search the web in Overlay browser.',
    inputSchema: z.object({
      query: z.string().describe('Search query')
    }),
    execute: async ({ query }) =>
      runWithLifecycle(options, 'search_web', { query }, async () => {
        const handler = browserHandlers?.searchWeb
        return handler ? handler({ query }) : defaultSearchWeb(query)
      })
  })
}

function addOsTools(tools: ToolSet, options: ToolSetOptions): void {
  tools.launch_app = tool({
    description: 'Launch or focus a macOS application by name.',
    inputSchema: z.object({
      app_name: z.string().describe('Application name, e.g. Safari')
    }),
    execute: async ({ app_name }) =>
      runWithLifecycle(options, 'launch_app', { app_name }, async () => {
        await execFileAsync('open', ['-a', app_name], { timeout: 10000 })
        return { success: true, app: app_name }
      })
  })

  tools.search_apps = tool({
    description: 'Search installed macOS applications.',
    inputSchema: z.object({
      query: z.string().describe('App name to search')
    }),
    execute: async ({ query }) =>
      runWithLifecycle(options, 'search_apps', { query }, async () => {
        const safeQuery = query.replace(/["'`$\\/]/g, '')
        const { stdout } = await execFileAsync(
          'find',
          [
            '/Applications',
            '/System/Applications',
            '-maxdepth',
            '2',
            '-name',
            '*.app',
            '-iname',
            `*${safeQuery}*`
          ],
          { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }
        )

        const apps = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => basename(line, '.app'))
          .slice(0, 20)

        return { success: true, apps, count: apps.length }
      })
  })

  tools.applescript_run = tool({
    description: 'Execute AppleScript for macOS automation.',
    inputSchema: z.object({
      script: z.string().describe('AppleScript source'),
      timeout_ms: z.number().optional().describe('Timeout in ms (max 30000)')
    }),
    execute: async ({ script, timeout_ms }) =>
      runWithLifecycle(options, 'applescript_run', { script: script.slice(0, 120) }, async () => {
        const timeout = Math.min(Math.max(timeout_ms || APPLESCRIPT_TIMEOUT_MS, 1000), 30000)
        const output = await runAppleScript(script, timeout)
        return { success: true, output: truncate(output) }
      })
  })

  tools.contacts_search = tool({
    description: 'Search macOS Contacts by name.',
    inputSchema: z.object({
      name: z.string().describe('Name to search')
    }),
    execute: async ({ name }) =>
      runWithLifecycle(options, 'contacts_search', { name }, async () => {
        const escapedName = escapeForAppleScript(name)
        const script = `
          set output to ""
          tell application "Contacts"
            set matchingPeople to (every person whose name contains "${escapedName}")
            repeat with p in matchingPeople
              set pName to name of p
              set pPhones to ""
              set pEmails to ""
              repeat with ph in phones of p
                set pPhones to pPhones & (value of ph) & ", "
              end repeat
              repeat with em in emails of p
                set pEmails to pEmails & (value of em) & ", "
              end repeat
              set output to output & pName & " | Phones: " & pPhones & " | Emails: " & pEmails & "\\n"
            end repeat
          end tell
          return output
        `

        const contacts = await runAppleScript(script)
        return { success: true, contacts }
      })
  })

  tools.imessage_send = tool({
    description: 'Send an iMessage to recipient email/phone.',
    inputSchema: z.object({
      recipient: z.string().describe('Recipient phone number or email'),
      message: z.string().describe('Message body')
    }),
    execute: async ({ recipient, message }) =>
      runWithLifecycle(options, 'imessage_send', { recipient }, async () => {
        const script = `
          tell application "Messages"
            set targetService to 1st account whose service type = iMessage
            set targetBuddy to participant "${escapeForAppleScript(recipient)}" of targetService
            send "${escapeForAppleScript(message)}" to targetBuddy
          end tell
          return "sent"
        `

        await runAppleScript(script)
        return { success: true, recipient }
      })
  })

  tools.reminders_create = tool({
    description: 'Create a reminder in macOS Reminders.',
    inputSchema: z.object({
      title: z.string().describe('Reminder title'),
      notes: z.string().optional().describe('Optional notes'),
      due_date: z.string().optional().describe('Optional due date string'),
      list_name: z.string().optional().describe('Reminders list name')
    }),
    execute: async ({ title, notes, due_date, list_name }) =>
      runWithLifecycle(options, 'reminders_create', { title, list_name, due_date }, async () => {
        const escapedTitle = escapeForAppleScript(title)
        const escapedNotes = notes ? escapeForAppleScript(notes) : ''
        const targetList = escapeForAppleScript(list_name || 'Reminders')

        let script = `
          tell application "Reminders"
            set targetList to list "${targetList}"
            set newReminder to make new reminder at targetList with properties {name:"${escapedTitle}"${escapedNotes ? `, body:"${escapedNotes}"` : ''}}
        `

        if (due_date) {
          script += `
            set dueDate to date "${escapeForAppleScript(due_date)}"
            set due date of newReminder to dueDate
          `
        }

        script += `
          end tell
          return "Reminder created: ${escapedTitle}"
        `

        const result = await runAppleScript(script)
        return { success: true, title, result }
      })
  })

  tools.reminders_list = tool({
    description: 'List reminders from macOS Reminders.',
    inputSchema: z.object({
      list_name: z.string().optional().describe('Specific list to query'),
      include_completed: z.boolean().optional().describe('Include completed reminders')
    }),
    execute: async ({ list_name, include_completed }) =>
      runWithLifecycle(options, 'reminders_list', { list_name, include_completed }, async () => {
        const script = list_name
          ? `
              tell application "Reminders"
                set output to ""
                set targetList to list "${escapeForAppleScript(list_name)}"
                repeat with r in (reminders of targetList whose completed is ${include_completed ? 'true' : 'false'})
                  set output to output & name of r & " | Due: " & (due date of r as string) & "\\n"
                end repeat
                return output
              end tell
            `
          : `
              tell application "Reminders"
                set output to ""
                repeat with l in lists
                  set output to output & "--- " & name of l & " ---\\n"
                  repeat with r in (reminders of l whose completed is ${include_completed ? 'true' : 'false'})
                    set output to output & name of r & "\\n"
                  end repeat
                end repeat
                return output
              end tell
            `

        const reminders = await runAppleScript(script)
        return { success: true, reminders }
      })
  })

  tools.timer_set = tool({
    description: 'Set a timer by creating a reminder due at duration.',
    inputSchema: z.object({
      duration_minutes: z.number().describe('Duration in minutes'),
      label: z.string().optional().describe('Timer label')
    }),
    execute: async ({ duration_minutes, label }) =>
      runWithLifecycle(options, 'timer_set', { duration_minutes, label }, async () => {
        const timerLabel = escapeForAppleScript(label || `Timer (${duration_minutes} min)`)
        const script = `
          set timerDate to (current date) + (${duration_minutes} * 60)
          tell application "Reminders"
            set targetList to default list
            make new reminder at targetList with properties {name:"${timerLabel}", due date:timerDate}
          end tell
          return "Timer set for ${duration_minutes} minutes"
        `

        const result = await runAppleScript(script)
        return { success: true, duration_minutes, label: timerLabel, result }
      })
  })

  tools.ax_list_apps = tool({
    description: 'List running macOS applications with PIDs.',
    inputSchema: z.object({}),
    execute: async () =>
      runWithLifecycle(options, 'ax_list_apps', {}, async () => runAxHelper(['list-apps']))
  })

  tools.ax_get_ui_tree = tool({
    description: 'Get accessibility tree for application PID.',
    inputSchema: z.object({
      pid: z.number().describe('Process ID'),
      depth: z.number().optional().describe('Tree depth (default 3)')
    }),
    execute: async ({ pid, depth }) =>
      runWithLifecycle(options, 'ax_get_ui_tree', { pid, depth }, async () =>
        runAxHelper(['tree', String(pid), String(depth || 3)])
      )
  })

  tools.ax_click = tool({
    description: 'Click AX element in app by role/title.',
    inputSchema: z.object({
      pid: z.number().describe('Process ID'),
      role: z.string().optional().describe('AX role'),
      title: z.string().optional().describe('Element title/text')
    }),
    execute: async ({ pid, role, title }) =>
      runWithLifecycle(options, 'ax_click', { pid, role, title }, async () => {
        const args = [String(pid), role || '', title || '']
        return runAxHelper(['click', ...args])
      })
  })

  tools.download_file = tool({
    description:
      'Download a public HTTP/HTTPS file into disposable storage for this agent task.',
    inputSchema: z.object({
      url: z.string().describe('File URL (http/https)'),
      filename: z.string().optional().describe('Optional filename override')
    }),
    execute: async ({ url, filename }) =>
      runWithLifecycle(options, 'download_file', { url, filename }, async () =>
        downloadFileToTaskFolder(options.securityTaskId, url, filename)
      )
  })

  tools.shortcuts_list = tool({
    description: 'List available Shortcuts.',
    inputSchema: z.object({
      show_identifiers: z.boolean().optional().describe('Include shortcut identifiers')
    }),
    execute: async ({ show_identifiers }) =>
      runWithLifecycle(options, 'shortcuts_list', { show_identifiers }, async () => {
        const args = ['list']
        if (show_identifiers) args.push('--show-identifiers')
        const { stdout } = await execFileAsync('shortcuts', args, {
          timeout: 15000,
          maxBuffer: 1024 * 1024
        })
        const lines = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        return { success: true, count: lines.length, shortcuts: lines }
      })
  })

  tools.shortcuts_run = tool({
    description: 'Run a Shortcut by name or identifier.',
    inputSchema: z.object({
      name_or_id: z.string().describe('Shortcut name or identifier'),
      input_path: z.string().optional().describe('Optional --input-path value'),
      output_path: z.string().optional().describe('Optional --output-path value'),
      output_type: z.string().optional().describe('Optional --output-type UTI')
    }),
    execute: async ({ name_or_id, input_path, output_path, output_type }) =>
      runWithLifecycle(
        options,
        'shortcuts_run',
        { name_or_id, input_path, output_path, output_type },
        async () => {
          const args = ['run', name_or_id]
          if (input_path) args.push('--input-path', input_path)
          if (output_path) args.push('--output-path', output_path)
          if (output_type) args.push('--output-type', output_type)

          const { stdout, stderr } = await execFileAsync('shortcuts', args, {
            timeout: 30000,
            maxBuffer: 1024 * 1024
          })

          return {
            success: true,
            output: truncate((stdout || stderr || '').trim())
          }
        }
      )
  })

  tools.shortcuts_view = tool({
    description: 'Open a Shortcut in the Shortcuts app.',
    inputSchema: z.object({
      name: z.string().describe('Shortcut name')
    }),
    execute: async ({ name }) =>
      runWithLifecycle(options, 'shortcuts_view', { name }, async () => {
        await execFileAsync('shortcuts', ['view', name], { timeout: 15000 })
        return { success: true, name }
      })
  })
}

const MAX_FILE_READ_BYTES = 512 * 1024 // 512 KB
const FS_DEFAULT_ALLOWED_DIRS = [
  homedir(),
  join(homedir(), 'Desktop'),
  join(homedir(), 'Documents'),
  join(homedir(), 'Downloads'),
  join(homedir(), 'Projects'),
  join(homedir(), 'Developer'),
  '/tmp'
]

function isPathAllowed(targetPath: string, allowedDirs: string[]): boolean {
  const resolved = resolve(targetPath)
  return allowedDirs.some((dir) => {
    const resolvedDir = resolve(dir)
    return resolved === resolvedDir || resolved.startsWith(`${resolvedDir}${sep}`)
  })
}

function addTerminalTools(tools: ToolSet, options: ToolSetOptions): void {
  tools.terminal_run = tool({
    description:
      'Execute a shell command and return stdout/stderr/exit code. Use for running scripts, installing packages, checking system state, git operations, etc. Commands that match dangerous patterns (rm -rf, sudo rm, dd, mkfs) are automatically blocked.',
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute'),
      cwd: z.string().optional().describe('Working directory (defaults to home)'),
      timeout_ms: z.number().optional().describe('Timeout in ms (default 60000, max 300000)')
    }),
    execute: async ({ command, cwd, timeout_ms }) =>
      runWithLifecycle(
        options,
        'terminal_run',
        { command: command.slice(0, 200), cwd },
        async () => {
          const result = await terminalService.runCommand(command, {
            cwd,
            timeoutMs: timeout_ms
          })
          return {
            success: result.success,
            exitCode: result.exitCode,
            output: truncate(result.stdout, MAX_TOOL_RESULT_CHARS),
            timedOut: result.timedOut,
            error: result.error
          }
        }
      )
  })

  tools.terminal_session_start = tool({
    description:
      'Start a persistent interactive terminal session. Use for long-running processes, interactive REPLs, or when you need to maintain state across multiple commands.',
    inputSchema: z.object({
      cwd: z.string().optional().describe('Working directory')
    }),
    execute: async ({ cwd }) =>
      runWithLifecycle(options, 'terminal_session_start', { cwd }, async () => {
        const session = terminalService.createSession(cwd)
        return { success: true, sessionId: session.id, cwd: session.cwd }
      })
  })

  tools.terminal_session_write = tool({
    description: 'Send input (keystrokes or a command + newline) to a persistent terminal session.',
    inputSchema: z.object({
      session_id: z.string().describe('Terminal session ID'),
      input: z.string().describe('Text to send (include \\n to press Enter)')
    }),
    execute: async ({ session_id, input }) =>
      runWithLifecycle(options, 'terminal_session_write', { session_id }, async () => {
        const ok = terminalService.writeToSession(session_id, input)
        if (!ok) return { success: false, error: 'Session not found' }
        return { success: true }
      })
  })

  tools.terminal_session_read = tool({
    description: 'Read recent output from a persistent terminal session.',
    inputSchema: z.object({
      session_id: z.string().describe('Terminal session ID'),
      last_n_lines: z.number().optional().describe('Number of recent lines to read (default: all)')
    }),
    execute: async ({ session_id, last_n_lines }) =>
      runWithLifecycle(options, 'terminal_session_read', { session_id }, async () => {
        const output = terminalService.readSessionOutput(session_id, last_n_lines)
        if (output === null) return { success: false, error: 'Session not found', output: '' }
        return { success: true, output: truncate(output, MAX_TOOL_RESULT_CHARS) }
      })
  })

  tools.terminal_session_kill = tool({
    description: 'Kill a persistent terminal session.',
    inputSchema: z.object({
      session_id: z.string().describe('Terminal session ID')
    }),
    execute: async ({ session_id }) =>
      runWithLifecycle(options, 'terminal_session_kill', { session_id }, async () => {
        const ok = terminalService.killSession(session_id)
        return { success: ok, error: ok ? undefined : 'Session not found' }
      })
  })

  tools.terminal_list_sessions = tool({
    description: 'List all active persistent terminal sessions.',
    inputSchema: z.object({}),
    execute: async () =>
      runWithLifecycle(options, 'terminal_list_sessions', {}, async () => {
        const sessions = terminalService.listSessions()
        return { success: true, sessions, count: sessions.length }
      })
  })
}

function addFileSystemTools(tools: ToolSet, options: ToolSetOptions): void {
  const allowedDirs = options.fsAllowedDirs?.length
    ? options.fsAllowedDirs
    : FS_DEFAULT_ALLOWED_DIRS

  function guardPath(targetPath: string): void {
    if (!isPathAllowed(targetPath, allowedDirs)) {
      throw new Error(
        `Access denied: "${targetPath}" is outside allowed directories. Allowed: ${allowedDirs.join(', ')}`
      )
    }
  }

  tools.fs_read_file = tool({
    description:
      'Read the contents of a file. Returns text content with line numbers for text files, or metadata for binary files. Max 512KB.',
    inputSchema: z.object({
      path: z.string().describe('Absolute path to the file'),
      offset: z.number().optional().describe('Start line (1-indexed, for partial reads)'),
      limit: z.number().optional().describe('Number of lines to read')
    }),
    execute: async ({ path: filePath, offset, limit }) =>
      runWithLifecycle(options, 'fs_read_file', { path: filePath }, async () => {
        guardPath(filePath)
        const stat = statSync(filePath)
        if (stat.size > MAX_FILE_READ_BYTES) {
          return {
            success: false,
            error: `File too large: ${stat.size} bytes (max ${MAX_FILE_READ_BYTES})`
          }
        }

        const raw = readFileSync(filePath, 'utf-8')
        const lines = raw.split('\n')

        if (offset || limit) {
          const start = Math.max((offset || 1) - 1, 0)
          const end = limit ? start + limit : lines.length
          const slice = lines.slice(start, end)
          const numbered = slice.map((line, i) => `${start + i + 1}: ${line}`).join('\n')
          return {
            success: true,
            path: filePath,
            totalLines: lines.length,
            startLine: start + 1,
            endLine: Math.min(end, lines.length),
            content: numbered
          }
        }

        const numbered = lines.map((line, i) => `${i + 1}: ${line}`).join('\n')
        return {
          success: true,
          path: filePath,
          size: stat.size,
          lines: lines.length,
          content: truncate(numbered, MAX_TOOL_RESULT_CHARS)
        }
      })
  })

  tools.fs_write_file = tool({
    description:
      'Write content to a file. Creates the file and any missing parent directories if they do not exist. Overwrites existing content.',
    inputSchema: z.object({
      path: z.string().describe('Absolute path to the file'),
      content: z.string().describe('Content to write')
    }),
    execute: async ({ path: filePath, content }) =>
      runWithLifecycle(options, 'fs_write_file', { path: filePath }, async () => {
        guardPath(filePath)
        auditSensitiveTool('tool:fs_write_file', { path: filePath, bytes: content.length }, true)
        mkdirSync(dirname(filePath), { recursive: true })
        writeFileSync(filePath, content, 'utf-8')
        return { success: true, path: filePath, bytes: content.length }
      })
  })

  tools.fs_list_dir = tool({
    description:
      'List files and directories at a given path. Returns name, type (file/directory), and size for each entry.',
    inputSchema: z.object({
      path: z.string().describe('Absolute directory path'),
      show_hidden: z.boolean().optional().describe('Include hidden files (default false)')
    }),
    execute: async ({ path: dirPath, show_hidden }) =>
      runWithLifecycle(options, 'fs_list_dir', { path: dirPath }, async () => {
        guardPath(dirPath)
        const entries = readdirSync(dirPath, { withFileTypes: true })
        const items = entries
          .filter((e) => show_hidden || !e.name.startsWith('.'))
          .slice(0, 200)
          .map((e) => {
            const fullPath = join(dirPath, e.name)
            try {
              const s = statSync(fullPath)
              return {
                name: e.name,
                type: e.isDirectory() ? 'directory' : 'file',
                size: e.isFile() ? s.size : undefined,
                modified: s.mtime.toISOString()
              }
            } catch {
              return { name: e.name, type: e.isDirectory() ? 'directory' : 'file' }
            }
          })
        return { success: true, path: dirPath, count: items.length, entries: items }
      })
  })

  tools.fs_search_files = tool({
    description:
      'Search for files by name pattern (glob) or content (grep) within a directory tree. Returns matching file paths.',
    inputSchema: z.object({
      path: z.string().describe('Directory to search in'),
      pattern: z.string().describe('Filename glob pattern (e.g. "*.ts") or text to search for'),
      type: z
        .enum(['name', 'content'])
        .optional()
        .describe('Search by filename or file content (default: name)'),
      max_results: z.number().optional().describe('Maximum results (default 50)')
    }),
    execute: async ({ path: searchPath, pattern, type: searchType, max_results }) =>
      runWithLifecycle(options, 'fs_search_files', { path: searchPath, pattern }, async () => {
        guardPath(searchPath)
        const maxResults = Math.min(max_results || 50, 200)

        if (searchType === 'content') {
          // Use grep for content search
          const { stdout } = await execFileAsync(
            'grep',
            ['-rl', '--include=*', '-m', '1', pattern, searchPath],
            { timeout: 30000, maxBuffer: 2 * 1024 * 1024 }
          ).catch(() => ({ stdout: '' }))

          const files = stdout.split('\n').filter(Boolean).slice(0, maxResults)
          return { success: true, matches: files, count: files.length, searchType: 'content' }
        }

        // Use find for filename search
        const { stdout } = await execFileAsync(
          'find',
          [searchPath, '-maxdepth', '5', '-name', pattern, '-type', 'f'],
          { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }
        ).catch(() => ({ stdout: '' }))

        const files = stdout.split('\n').filter(Boolean).slice(0, maxResults)
        return { success: true, matches: files, count: files.length, searchType: 'name' }
      })
  })

  tools.fs_move = tool({
    description: 'Move or rename a file or directory.',
    inputSchema: z.object({
      source: z.string().describe('Source path'),
      destination: z.string().describe('Destination path')
    }),
    execute: async ({ source, destination }) =>
      runWithLifecycle(options, 'fs_move', { source, destination }, async () => {
        guardPath(source)
        guardPath(destination)
        auditSensitiveTool('tool:fs_move', { source, destination }, true)
        mkdirSync(dirname(destination), { recursive: true })
        renameSync(source, destination)
        return { success: true, source, destination }
      })
  })

  tools.fs_copy = tool({
    description: 'Copy a file to a new location.',
    inputSchema: z.object({
      source: z.string().describe('Source file path'),
      destination: z.string().describe('Destination file path')
    }),
    execute: async ({ source, destination }) =>
      runWithLifecycle(options, 'fs_copy', { source, destination }, async () => {
        guardPath(source)
        guardPath(destination)
        auditSensitiveTool('tool:fs_copy', { source, destination }, true)
        mkdirSync(dirname(destination), { recursive: true })
        copyFileSync(source, destination)
        return { success: true, source, destination }
      })
  })

  tools.fs_delete = tool({
    description:
      'Delete a file or empty directory. For safety, this does NOT recursively delete directories with content.',
    inputSchema: z.object({
      path: z.string().describe('Path to delete'),
      recursive: z
        .boolean()
        .optional()
        .describe('Allow recursive directory deletion (use with caution)')
    }),
    execute: async ({ path: targetPath, recursive }) =>
      runWithLifecycle(options, 'fs_delete', { path: targetPath, recursive }, async () => {
        guardPath(targetPath)
        auditSensitiveTool('tool:fs_delete', { path: targetPath, recursive }, true)
        const stat = statSync(targetPath)
        if (stat.isDirectory()) {
          rmSync(targetPath, { recursive: recursive === true })
        } else {
          unlinkSync(targetPath)
        }
        return { success: true, path: targetPath }
      })
  })

  tools.fs_info = tool({
    description:
      'Get detailed metadata about a file or directory (size, type, permissions, timestamps).',
    inputSchema: z.object({
      path: z.string().describe('Absolute path')
    }),
    execute: async ({ path: targetPath }) =>
      runWithLifecycle(options, 'fs_info', { path: targetPath }, async () => {
        guardPath(targetPath)
        const stat = statSync(targetPath)
        return {
          success: true,
          path: targetPath,
          exists: true,
          type: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file',
          size: stat.size,
          extension: stat.isFile() ? extname(targetPath) : undefined,
          created: stat.birthtime.toISOString(),
          modified: stat.mtime.toISOString(),
          accessed: stat.atime.toISOString(),
          permissions: stat.mode.toString(8)
        }
      })
  })
}

function addScriptTools(tools: ToolSet, options: ToolSetOptions): void {
  const defaultCwd = options.workingFolder || undefined

  tools.script_run = tool({
    description:
      'Execute a Python or JavaScript script. Python runs in a shared persistent environment with common data-science libraries pre-installed (pandas, pymupdf, openpyxl, beautifulsoup4, Pillow, requests, etc.). Extra packages are auto-installed and persist across sessions. If a working folder has its own venv, that is used instead. For JavaScript, uses Node.js. Use this for data analysis, PDF parsing, web scraping, image processing, file transformations, and any task best solved with code.',
    inputSchema: z.object({
      runtime: z
        .enum(['python', 'javascript'])
        .describe('Script runtime: "python" or "javascript"'),
      code: z.string().describe('The script source code to execute'),
      packages: z
        .array(z.string())
        .optional()
        .describe(
          'Extra Python packages to install before running (e.g. ["scipy", "matplotlib"]). Common packages like pandas, pymupdf, openpyxl, beautifulsoup4, Pillow, requests are already available. Ignored for JS.'
        ),
      timeout_ms: z.number().optional().describe('Timeout in ms (default 120000, max 300000)')
    }),
    execute: async ({ runtime, code, packages, timeout_ms }) =>
      runWithLifecycle(
        options,
        'script_run',
        { runtime, codeLength: code.length, packages: packages?.join(', ') || 'none' },
        async () => {
          const result = await runtimeService.runScript({
            runtime,
            code,
            packages: runtime === 'python' ? packages : undefined,
            cwd: defaultCwd,
            timeoutMs: timeout_ms
          })
          return {
            success: result.success,
            stdout: truncate(result.stdout, MAX_TOOL_RESULT_CHARS),
            stderr: result.stderr ? truncate(result.stderr, 2000) : undefined,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            error: result.error
          }
        }
      )
  })

  tools.install_packages = tool({
    description:
      'Install Python packages into the shared Overlay environment. Packages persist across sessions and are available to all future script_run calls. Use this when you need to pre-install packages before running scripts, or when a script fails due to a missing package.',
    inputSchema: z.object({
      packages: z
        .array(z.string())
        .describe('Packages to install (e.g. ["scipy", "matplotlib", "seaborn"])')
    }),
    execute: async ({ packages }) =>
      runWithLifecycle(options, 'install_packages', { packages: packages.join(', ') }, async () =>
        runtimeService.installPackages(packages)
      )
  })
}

function addCompletionTools(tools: ToolSet, options: ToolSetOptions): void {
  if (options.surface === 'chat') {
    tools.done = tool({
      description:
        'Signal task completion. You MUST call this when finished. The summary field is REQUIRED and must be a clear, non-empty explanation of what was accomplished (or what was attempted and why it could not be completed). Never call done with an empty or vague summary.',
      inputSchema: z.object({
        summary: z
          .string()
          .min(10)
          .describe(
            'REQUIRED: A clear explanation of what was accomplished. Be specific — list what you did and the outcome.'
          )
      })
    })
    return
  }

  tools.task_complete = tool({
    description: 'Signal task completion.',
    inputSchema: z.object({
      summary: z.string().describe('Summary of accomplishment'),
      success: z.boolean().describe('Whether task fully succeeded')
    })
  })
}

function addDirectComposioExecuteTool(tools: ToolSet, options: ToolSetOptions): void {
  tools.composio_execute = tool({
    description: 'Execute a Composio integration tool directly by name.',
    inputSchema: z.object({
      tool_name: z.string().describe('Composio tool name'),
      arguments: z.record(z.string(), z.any()).describe('Arguments for tool')
    }),
    execute: async ({ tool_name, arguments: args }) =>
      runWithLifecycle(options, 'composio_execute', { tool_name }, async () =>
        executeComposioTool(tool_name, args as JsonRecord)
      )
  })
}

function addCodingTools(tools: ToolSet, options: ToolSetOptions): void {
  const cwd = options.workingFolder || undefined

  tools.code_edit_file = tool({
    description:
      'Make surgical find-and-replace edits to a file. Finds the exact old_string in the file and replaces it with new_string. Fails if old_string is not found or is not unique.',
    inputSchema: z.object({
      path: z.string().describe('Absolute path to the file to edit'),
      old_string: z.string().describe('Exact string to find (must be unique in the file)'),
      new_string: z.string().describe('String to replace it with')
    }),
    execute: async ({ path: filePath, old_string, new_string }) =>
      runWithLifecycle(
        options,
        'code_edit_file',
        { path: filePath, old_string, new_string },
        async () => {
          const { existsSync, readFileSync: rfs, writeFileSync: wfs } = await import('node:fs')
          if (!existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` }
          const content = rfs(filePath, 'utf-8')
          const occurrences = content.split(old_string).length - 1
          if (occurrences === 0) return { success: false, error: 'old_string not found in file' }
          if (occurrences > 1)
            return {
              success: false,
              error: `old_string appears ${occurrences} times — must be unique. Provide more context.`
            }
          auditSensitiveTool('tool:code_edit_file', { path: filePath }, true)
          wfs(filePath, content.replace(old_string, new_string), 'utf-8')
          return { success: true, path: filePath }
        }
      )
  })

  tools.code_search_codebase = tool({
    description:
      'Search the codebase for a pattern using ripgrep-style text search. Returns file paths, line numbers, and matching lines.',
    inputSchema: z.object({
      pattern: z.string().describe('Search pattern (regex or literal string)'),
      directory: z
        .string()
        .optional()
        .describe('Directory to search in (defaults to working folder)'),
      file_glob: z.string().optional().describe('File glob filter, e.g. "*.ts" or "**/*.py"'),
      case_sensitive: z.boolean().optional().describe('Case-sensitive search (default false)')
    }),
    execute: async ({ pattern, directory, file_glob, case_sensitive }) =>
      runWithLifecycle(
        options,
        'code_search_codebase',
        { pattern, directory, file_glob },
        async () => {
          const searchDir = directory || cwd || homedir()
          const flags = case_sensitive ? '' : '-i '
          const globFlag = file_glob ? `-g '${file_glob}' ` : ''
          const cmd = `rg ${flags}${globFlag}--line-number --max-count 50 -e '${pattern.replace(/'/g, "'\\''")}' '${searchDir}'`
          const result = await terminalService.runCommand(cmd, { cwd: searchDir, timeoutMs: 15000 })
          return {
            success: result.success || result.stdout.length > 0,
            matches: result.stdout || result.stderr || 'No matches found'
          }
        }
      )
  })

  tools.code_run_tests = tool({
    description:
      'Run the project test suite. Detects the test runner from package.json (jest, vitest, mocha, etc.) and runs it.',
    inputSchema: z.object({
      pattern: z.string().optional().describe('Optional test file pattern or test name filter'),
      timeout_ms: z.number().optional().describe('Timeout in ms (default 60000)')
    }),
    execute: async ({ pattern, timeout_ms }) =>
      runWithLifecycle(options, 'code_run_tests', { pattern }, async () => {
        const testCwd = cwd || homedir()
        const patternFlag = pattern ? ` -- ${pattern}` : ''
        const cmd = `npm test${patternFlag} 2>&1 || true`
        const result = await terminalService.runCommand(cmd, {
          cwd: testCwd,
          timeoutMs: timeout_ms ?? 60000
        })
        return {
          success: result.success,
          output: truncate(result.stdout, MAX_TOOL_RESULT_CHARS),
          exitCode: result.exitCode
        }
      })
  })

  tools.code_git_status = tool({
    description: 'Get the current git status: staged, unstaged, and untracked files.',
    inputSchema: z.object({}),
    execute: async () =>
      runWithLifecycle(options, 'code_git_status', {}, async () => {
        const result = await terminalService.runCommand('git status --short --branch', {
          cwd: cwd || homedir()
        })
        return { success: result.success, status: result.stdout || result.stderr }
      })
  })

  tools.code_git_diff = tool({
    description:
      'Show git diff for changed files. Can diff staged changes, unstaged, or a specific file.',
    inputSchema: z.object({
      staged: z.boolean().optional().describe('Show staged diff (default false = unstaged)'),
      path: z.string().optional().describe('Limit diff to a specific file path')
    }),
    execute: async ({ staged, path: filePath }) =>
      runWithLifecycle(options, 'code_git_diff', { staged, path: filePath }, async () => {
        const stagedFlag = staged ? '--staged ' : ''
        const pathArg = filePath ? ` -- '${filePath}'` : ''
        const result = await terminalService.runCommand(
          `git diff ${stagedFlag}--stat${pathArg} && git diff ${stagedFlag}${pathArg}`,
          { cwd: cwd || homedir(), timeoutMs: 15000 }
        )
        return { success: result.success, diff: truncate(result.stdout, MAX_TOOL_RESULT_CHARS) }
      })
  })

  tools.code_git_commit = tool({
    description: 'Stage all changes and create a git commit with the provided message.',
    inputSchema: z.object({
      message: z.string().describe('Commit message'),
      stage_all: z
        .boolean()
        .optional()
        .describe('Stage all modified/new files before committing (default true)')
    }),
    execute: async ({ message, stage_all = true }) =>
      runWithLifecycle(options, 'code_git_commit', { message }, async () => {
        auditSensitiveTool('tool:code_git_commit', { message }, true)
        const stageCmd = stage_all ? 'git add -A && ' : ''
        const result = await terminalService.runCommand(
          `${stageCmd}git commit -m '${message.replace(/'/g, "'\\''")}' 2>&1`,
          { cwd: cwd || homedir(), timeoutMs: 20000 }
        )
        return { success: result.success, output: result.stdout || result.stderr }
      })
  })

  tools.code_lint = tool({
    description:
      'Run the project linter (eslint, biome, ruff, etc.) and return errors and warnings.',
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe('Specific file or directory to lint (defaults to working folder)')
    }),
    execute: async ({ path: lintPath }) =>
      runWithLifecycle(options, 'code_lint', { path: lintPath }, async () => {
        const targetPath = lintPath || '.'
        const lintCwd = cwd || homedir()
        const cmd = `npx eslint '${targetPath}' --format compact 2>&1 || npx biome check '${targetPath}' 2>&1 || true`
        const result = await terminalService.runCommand(cmd, {
          cwd: lintCwd,
          timeoutMs: 30000
        })
        return {
          success: result.success,
          output: truncate(result.stdout, MAX_TOOL_RESULT_CHARS)
        }
      })
  })
}

/**
 * Add web search tool via AI Gateway's provider-defined parallelSearch.
 *
 * ToolLoopAgent stops on tools without a local execute function — including
 * provider-defined gateway tools. To work around this, we wrap the gateway tool
 * in a custom tool() with execute. Inside execute, we call generateText with
 * parallelSearch as an inner tool (gateway handles execution) and maxSteps so
 * the model can call the tool and generate a grounded response.
 * Cost: $5 per 1000 requests (parallelSearch).
 */
async function addWebSearchTool(tools: ToolSet, options: ToolSetOptions): Promise<void> {
  try {
    const { getGateway } = await import('../ai/gateway-provider')
    const { generateText: genText, stepCountIs } = await import('ai')
    const gateway = await getGateway()
    const gw = gateway as any
    if (!gw.tools?.parallelSearch) {
      console.warn('[UnifiedTools] Gateway does not expose tools.parallelSearch — skipping')
      return
    }

    // Use provided searchModelId or fall back to a cheap fast default
    const searchModel = options.searchModelId ?? 'openai/gpt-oss-20b'

    tools.web_search_tool = tool({
      description:
        'Search the web for current information, news, research, and real-time data. Returns summarized results with sources. Use for any question requiring up-to-date information.',
      inputSchema: z.object({
        query: z.string().describe('The search query')
      }),
      execute: async ({ query }) =>
        runWithLifecycle(options, 'web_search_tool', { query }, async () => {
          try {
            const { text } = await genText({
              model: gw(searchModel),
              prompt: `Answer this based on current web search results: ${query}`,
              tools: {
                parallel_search: gw.tools.parallelSearch({ maxResults: 5 })
              },
              stopWhen: stepCountIs(3)
            })
            console.log(
              `[UnifiedTools] Web search done for "${query.slice(0, 50)}", ${text.length} chars`
            )
            return text || 'No search results found.'
          } catch (err) {
            console.error('[UnifiedTools] Web search failed:', err)
            return `Search failed: ${err instanceof Error ? err.message : String(err)}`
          }
        })
    })
    console.log(`[UnifiedTools] Web search tool added (model: ${searchModel})`)
  } catch (err) {
    console.error('[UnifiedTools] Failed to add web search tool:', err)
  }
}

export async function createUnifiedTools(options: ToolSetOptions): Promise<ToolSet> {
  const tools: ToolSet = {}
  const permissionMode = settingsService.chatToolPermissionMode
  const localAgentCapabilitiesEnabled = areChatAgentLocalCapabilitiesEnabled(
    options.surface,
    permissionMode,
    app.isPackaged
  )

  const includeCoreTools = options.includeCoreTools ?? true
  const includeOsTools = localAgentCapabilitiesEnabled && (options.includeOsTools ?? true)
  const includeBrowserTools =
    localAgentCapabilitiesEnabled &&
    (options.includeBrowserTools ??
      (options.surface === 'browser' || options.surface === 'voice' || options.surface === 'chat'))
  const includeDirectComposioExecute =
    localAgentCapabilitiesEnabled &&
    (options.includeDirectComposioExecute ?? options.surface === 'browser')

  if (includeCoreTools) {
    addCoreTools(tools, options)
  }

  if (includeBrowserTools) {
    addBrowserTools(tools, options)
  }

  // Headless browser tools — available on browser surface only
  const includeHeadlessBrowserTools =
    localAgentCapabilitiesEnabled && options.surface === 'browser'
  if (includeHeadlessBrowserTools) {
    addHeadlessBrowserTools(tools, options)
  }

  if (includeOsTools) {
    addOsTools(tools, options)
  }

  // Terminal tools — available on chat and browser surfaces (not notebook)
  const includeTerminalTools =
    localAgentCapabilitiesEnabled &&
    (options.includeTerminalTools ??
      (options.surface === 'chat' || options.surface === 'browser' || options.surface === 'voice'))
  if (includeTerminalTools) {
    addTerminalTools(tools, options)
  }

  // File system tools — available on chat and browser surfaces (not notebook)
  // If workingFolder is set, inject it into fsAllowedDirs
  if (options.workingFolder) {
    options.fsAllowedDirs = [
      ...(options.fsAllowedDirs || FS_DEFAULT_ALLOWED_DIRS),
      options.workingFolder
    ]
  }
  const includeFileSystemTools =
    localAgentCapabilitiesEnabled &&
    (options.includeFileSystemTools ??
      (options.surface === 'chat' || options.surface === 'browser' || options.surface === 'voice'))
  if (includeFileSystemTools) {
    addFileSystemTools(tools, options)
  }

  // Script execution tools (uv Python / Node.js)
  const includeScriptTools =
    localAgentCapabilitiesEnabled &&
    (options.includeScriptTools ??
      (options.surface === 'chat' || options.surface === 'browser' || options.surface === 'voice'))
  if (includeScriptTools) {
    addScriptTools(tools, options)
  }

  // Web search tool via AI Gateway (parallelSearch wrapped with execute)
  if (localAgentCapabilitiesEnabled && options.searchEnabled) {
    await addWebSearchTool(tools, options)
  }

  // Coding tools — available on chat surface when explicitly requested
  const includeCodingTools =
    localAgentCapabilitiesEnabled &&
    (options.includeCodingTools ??
      (options.surface === 'chat' && options.workingFolder !== undefined))
  if (includeCodingTools) {
    addCodingTools(tools, options)
  }

  if (options.surface === 'notebook') {
    addNotebookTools(tools, options)
  } else {
    addCompletionTools(tools, options)
  }

  if (includeDirectComposioExecute) {
    addDirectComposioExecuteTool(tools, options)
  }

  if (localAgentCapabilitiesEnabled && options.composio?.includeMetaTools) {
    await addComposioMetaTools(tools, options)
  }

  if (!localAgentCapabilitiesEnabled) {
    applyContainmentToolProfile(tools)
  }

  // Runtime default-deny complements the static registry check. A newly added
  // or dynamically injected tool cannot become model-callable until it has an
  // explicit security classification.
  assertEveryToolIsRegistered(Object.keys(tools))

  return secureAgentToolSet(tools, {
    surface: options.surface,
    taskId: options.securityTaskId,
    permissionMode
  })
}
