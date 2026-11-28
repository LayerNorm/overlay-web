import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { localPlanProviders, type LocalPlanProvider, type LocalPlans } from '@overlay/desktop-bridge'
import { resolveCliProxyBinary } from './embedded-host-config'
import { createLocalHelperEnvironment } from './security/local-helper-process'
import { safeStorageService } from './security/safe-storage-service'
import {
  groupCredentialFiles,
  isCredentialFileName,
  parseStoredPlan,
  renderProxyConfig,
  runPlanSignIn,
  type StoredPlan
} from './plan-proxy'

/**
 * Private threads on a person's Claude or ChatGPT plan (internal/develop/private-threads.md). Overlay Desktop runs the
 * bundled CLIProxyAPI on 127.0.0.1, on a random port, for the Agent Host only, with secrets made for this launch.
 *
 * The plan's tokens live in the system keychain through `safeStorage` (`private-plan-<plan>.enc`). While the proxy
 * runs they are also in its credential folder, readable by this user only, because CLIProxyAPI reads and refreshes
 * them there; every change is copied back to the keychain, and the folder is deleted when the proxy stops. Tokens are
 * never sent to Overlay's servers or to the page.
 */
const RECORD_PREFIX = 'private-plan-'
const START_TIMEOUT_MS = 15_000
const SYNC_DEBOUNCE_MS = 300

type Running = { child: ChildProcess; url: string; key: string; managementKey: string; authDirectory: string; watcher: FSWatcher | null }

const recordKey = (plan: LocalPlanProvider) => `${RECORD_PREFIX}${plan}`

function readStored(plan: LocalPlanProvider): StoredPlan | null {
  return parseStoredPlan(safeStorageService.getSecureValue(recordKey(plan)))
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port'))))
    })
  })
}

class PlanProxyService {
  private running: Running | null = null
  private starting: Promise<Running> | null = null
  private signIn: AbortController | null = null
  private syncTimer: NodeJS.Timeout | null = null

  private binary(): string | null {
    if (process.platform !== 'darwin') return null
    return resolveCliProxyBinary({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
  }

  /** Whether this copy of Overlay has the proxy. */
  bundled(): boolean {
    return this.binary() !== null
  }

  /** Read from the keychain; never starts the proxy. */
  status(available: boolean, overlayModels: boolean): LocalPlans {
    const plans = Object.fromEntries(localPlanProviders.map((plan) => {
      const stored = readStored(plan)
      return [plan, { signedIn: Boolean(stored), account: stored?.account ?? null }]
    })) as Record<LocalPlanProvider, { signedIn: boolean; account: string | null }>
    return { available, overlayModels, ...plans }
  }

  signedIn(plan: LocalPlanProvider): boolean {
    return readStored(plan) !== null
  }

  /** The proxy's address and the Agent Host's key, for one run; starts the proxy when needed. */
  async access(): Promise<{ url: string; key: string }> {
    const running = await this.ensure()
    return { url: running.url, key: running.key }
  }

  private runDirectory(): string {
    return join(app.getPath('userData'), 'private-threads', 'plans')
  }

  private ensure(): Promise<Running> {
    if (this.running && this.running.child.exitCode === null) return Promise.resolve(this.running)
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => { this.starting = null })
    return this.starting
  }

  private async start(): Promise<Running> {
    const binary = this.binary()
    if (!binary) throw new Error('This copy of Overlay can’t use plans. Update Overlay.')
    const directory = this.runDirectory()
    rmSync(directory, { recursive: true, force: true })
    const authDirectory = join(directory, 'credentials')
    mkdirSync(authDirectory, { recursive: true, mode: 0o700 })
    for (const plan of localPlanProviders) {
      for (const [name, text] of Object.entries(readStored(plan)?.files ?? {})) {
        writeFileSync(join(authDirectory, name), text, { mode: 0o600 })
      }
    }
    const port = await freePort()
    const key = `ovlp_${randomBytes(24).toString('hex')}`
    const managementKey = randomBytes(24).toString('hex')
    const configPath = join(directory, 'config.yaml')
    writeFileSync(configPath, renderProxyConfig({ port, clientKey: key, managementKey, authDirectory }), { mode: 0o600 })
    const child = spawn(binary, ['-config', configPath, '-local-model'], {
      cwd: directory,
      env: createLocalHelperEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    // Its output can name accounts; it is drained, never logged.
    child.stdout?.resume()
    child.stderr?.resume()
    const url = `http://127.0.0.1:${port}`
    const running: Running = { child, url, key, managementKey, authDirectory, watcher: null }
    child.once('exit', () => {
      if (this.running !== running) return
      this.sync(running)
      running.watcher?.close()
      this.running = null
      rmSync(directory, { recursive: true, force: true })
    })
    try {
      await this.waitUntilReady(running)
    } catch (error) {
      child.kill('SIGTERM')
      rmSync(directory, { recursive: true, force: true })
      throw error
    }
    try {
      running.watcher = watch(authDirectory, () => this.scheduleSync(running))
    } catch {
      /* Sign-in and sign-out sync explicitly; refreshes are synced when the proxy stops. */
    }
    this.running = running
    return running
  }

  private async waitUntilReady(running: Running): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (running.child.exitCode !== null) throw new Error('Plans could not start on this computer.')
      const ok = await fetch(`${running.url}/v1/models`, {
        headers: { authorization: `Bearer ${running.key}` },
        signal: AbortSignal.timeout(1_000)
      }).then((response) => response.ok, () => false)
      if (ok) return
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error('Plans did not start in time.')
  }

  private management(running: Running) {
    return (path: string, init: RequestInit = {}) => fetch(`${running.url}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${running.managementKey}` },
      signal: init.signal ?? AbortSignal.timeout(15_000)
    })
  }

  private scheduleSync(running: Running): void {
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => { this.syncTimer = null; this.sync(running) }, SYNC_DEBOUNCE_MS)
  }

  /** Copies the proxy's credential files back to the keychain: new sign-ins and refreshed tokens. */
  private sync(running: Running): void {
    let names: string[]
    try {
      names = readdirSync(running.authDirectory).filter(isCredentialFileName)
    } catch {
      return
    }
    const files: Record<string, string> = {}
    for (const name of names) {
      try { files[name] = readFileSync(join(running.authDirectory, name), 'utf8') } catch { /* Being rewritten; the next change syncs it. */ }
    }
    const grouped = groupCredentialFiles(files)
    for (const plan of localPlanProviders) {
      const next = grouped[plan]
      // Sign-out removes a plan explicitly; a plan missing for a moment while a file is rewritten is kept.
      if (next) safeStorageService.storeSecureValue(recordKey(plan), JSON.stringify(next))
    }
  }

  async signInTo(plan: LocalPlanProvider): Promise<void> {
    this.signIn?.abort()
    const controller = new AbortController()
    this.signIn = controller
    const running = await this.ensure()
    try {
      await runPlanSignIn({
        plan,
        proxyUrl: running.url,
        management: this.management(running),
        openBrowser: (url) => shell.openExternal(url),
        signal: controller.signal
      })
      this.sync(running)
      if (!this.signedIn(plan)) throw new Error('Sign-in didn’t finish. Try again.')
    } finally {
      if (this.signIn === controller) this.signIn = null
    }
  }

  cancelSignIn(): void {
    this.signIn?.abort()
  }

  async signOut(plan: LocalPlanProvider): Promise<void> {
    const stored = readStored(plan)
    const running = this.running
    if (running && stored) {
      const management = this.management(running)
      for (const name of Object.keys(stored.files)) {
        await management(`/v0/management/auth-files?name=${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => undefined)
        rmSync(join(running.authDirectory, name), { force: true })
      }
    }
    // After the files are gone, so a pending sync can't bring the plan back.
    if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = null }
    safeStorageService.deleteSecureValue(recordKey(plan))
  }

  /** Quitting or signing out of Overlay stops the proxy; the plans stay signed in, in the keychain. */
  stop(): void {
    const running = this.running
    this.signIn?.abort()
    if (!running) return
    this.sync(running)
    this.running = null
    running.watcher?.close()
    running.child.kill('SIGTERM')
    rmSync(this.runDirectory(), { recursive: true, force: true })
  }
}

export const planProxyService = new PlanProxyService()
