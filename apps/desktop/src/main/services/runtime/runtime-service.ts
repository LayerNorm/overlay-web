import { homedir, platform, arch } from 'node:os'
import { join } from 'node:path'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { auditLogger } from '../security/security-service'

const execFileAsync = promisify(execFile)

// ── Directories ──────────────────────────────────────────────────────────────
const OVERLAY_DIR = join(homedir(), '.overlay')
const RUNTIMES_DIR = join(OVERLAY_DIR, 'runtimes')
const BASE_ENV_DIR = join(OVERLAY_DIR, 'runtime')
const BASE_VENV_PATH = join(BASE_ENV_DIR, '.venv')
const PACKAGE_TRACKER_PATH = join(BASE_ENV_DIR, 'package-tracker.json')

// ── Limits ───────────────────────────────────────────────────────────────────
const DEFAULT_SCRIPT_TIMEOUT_MS = 120_000
const MAX_SCRIPT_TIMEOUT_MS = 300_000
const MAX_OUTPUT_BYTES = 1024 * 1024 // 1 MB
const STALE_SESSION_THRESHOLD = 10 // Remove packages unused for 10+ app sessions

// ── Default libraries (cannot be removed by cleanup) ─────────────────────────
const DEFAULT_PACKAGES = [
  'pymupdf', // PDF parsing
  'openpyxl', // Excel (.xlsx) read/write
  'python-docx', // Word (.docx) read/write
  'pandas', // Data analysis, CSV/Excel/JSON
  'beautifulsoup4', // HTML/XML parsing
  'lxml', // Fast XML/HTML parser (bs4 backend)
  'Pillow', // Image processing
  'chardet', // Character encoding detection
  'pyyaml', // YAML parsing
  'requests', // HTTP client
  'python-pptx' // PowerPoint read/write
]

export interface ScriptResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode?: number
  timedOut?: boolean
  sandboxPath?: string
  error?: string
}

// Session-based package tracker persisted to disk
interface PackageTracker {
  /** Current app session number (incremented on each app start) */
  sessionNumber: number
  /** Map of non-default package name → last session number it was used */
  packages: Record<string, number>
}

function getUvDownloadUrl(): string {
  const os = platform()
  const cpuArch = arch()

  if (os === 'darwin') {
    return cpuArch === 'arm64'
      ? 'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz'
      : 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-apple-darwin.tar.gz'
  } else if (os === 'linux') {
    return cpuArch === 'arm64'
      ? 'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-unknown-linux-gnu.tar.gz'
      : 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz'
  } else if (os === 'win32') {
    return 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip'
  }
  throw new Error(`Unsupported platform: ${os}/${cpuArch}`)
}

class RuntimeService {
  private uvPath: string | null = null
  private baseEnvReady = false
  private packageTracker: PackageTracker = { sessionNumber: 0, packages: {} }

  constructor() {
    mkdirSync(RUNTIMES_DIR, { recursive: true })
    mkdirSync(BASE_ENV_DIR, { recursive: true })
    this.loadPackageTracker()
    // Increment session on construction (app start)
    this.packageTracker.sessionNumber++
    this.savePackageTracker()
  }

  // ── Package Tracker ──────────────────────────────────────────────────────

  private loadPackageTracker(): void {
    try {
      if (existsSync(PACKAGE_TRACKER_PATH)) {
        const data = JSON.parse(readFileSync(PACKAGE_TRACKER_PATH, 'utf-8'))
        this.packageTracker = {
          sessionNumber: data.sessionNumber ?? 0,
          packages: data.packages ?? {}
        }
      }
    } catch {
      this.packageTracker = { sessionNumber: 0, packages: {} }
    }
  }

  private savePackageTracker(): void {
    try {
      writeFileSync(PACKAGE_TRACKER_PATH, JSON.stringify(this.packageTracker, null, 2), 'utf-8')
    } catch (err) {
      console.error('[RuntimeService] Failed to save package tracker:', err)
    }
  }

  /** Mark non-default packages as used in the current session */
  private trackPackageUsage(packages: string[]): void {
    const defaultSet = new Set(DEFAULT_PACKAGES.map((p) => p.toLowerCase()))
    for (const pkg of packages) {
      const name = pkg.toLowerCase().split('==')[0].split('>=')[0].split('<=')[0].trim()
      if (!defaultSet.has(name)) {
        this.packageTracker.packages[name] = this.packageTracker.sessionNumber
      }
    }
    this.savePackageTracker()
  }

  // ── uv Binary ────────────────────────────────────────────────────────────

  getUvBinaryPath(): string {
    const name = platform() === 'win32' ? 'uv.exe' : 'uv'
    return join(RUNTIMES_DIR, name)
  }

  isUvInstalled(): boolean {
    if (this.uvPath && existsSync(this.uvPath)) return true
    const binPath = this.getUvBinaryPath()
    if (existsSync(binPath)) {
      this.uvPath = binPath
      return true
    }
    return false
  }

  async ensurePythonRuntime(): Promise<{ ready: boolean; path: string; error?: string }> {
    if (this.isUvInstalled()) {
      return { ready: true, path: this.uvPath! }
    }

    try {
      console.log('[RuntimeService] Downloading uv...')
      const url = getUvDownloadUrl()
      const binPath = this.getUvBinaryPath()

      const tmpArchive = join(RUNTIMES_DIR, 'uv-download.tar.gz')

      const response = await fetch(url)
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download uv: ${response.status} ${response.statusText}`)
      }

      const fileStream = createWriteStream(tmpArchive)
      await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream)

      if (platform() === 'win32') {
        await execFileAsync('powershell', [
          '-Command',
          `Expand-Archive -Path "${tmpArchive}" -DestinationPath "${RUNTIMES_DIR}" -Force`
        ])
      } else {
        await execFileAsync('tar', ['xzf', tmpArchive, '-C', RUNTIMES_DIR, '--strip-components=1'])
      }

      try {
        rmSync(tmpArchive, { force: true })
      } catch {
        // ignore cleanup errors
      }

      if (!existsSync(binPath)) {
        throw new Error(`uv binary not found after extraction at ${binPath}`)
      }

      if (platform() !== 'win32') {
        await execFileAsync('chmod', ['+x', binPath])
      }

      this.uvPath = binPath
      console.log('[RuntimeService] uv installed successfully at', binPath)

      auditLogger.log({
        type: 'ipc:sensitive_call',
        action: 'runtime:uv_installed',
        details: { path: binPath },
        success: true
      })

      return { ready: true, path: binPath }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error('[RuntimeService] Failed to install uv:', error)
      return { ready: false, path: '', error }
    }
  }

  // ── Base Environment ─────────────────────────────────────────────────────

  /** Ensure the shared base venv exists and has default packages installed */
  async ensureBaseEnv(): Promise<{ ready: boolean; error?: string }> {
    if (this.baseEnvReady) return { ready: true }

    const uvReady = await this.ensurePythonRuntime()
    if (!uvReady.ready) {
      return { ready: false, error: `uv not available: ${uvReady.error}` }
    }

    try {
      // Create venv if it doesn't exist
      if (!existsSync(BASE_VENV_PATH)) {
        console.log('[RuntimeService] Creating shared base venv...')
        await execFileAsync(this.uvPath!, ['venv', BASE_VENV_PATH], {
          cwd: BASE_ENV_DIR,
          timeout: 60_000
        })
      }

      // Install default packages (idempotent — pip install is fast for already-installed pkgs)
      console.log('[RuntimeService] Ensuring default packages in base env...')
      await execFileAsync(this.uvPath!, ['pip', 'install', ...DEFAULT_PACKAGES], {
        cwd: BASE_ENV_DIR,
        timeout: 180_000,
        env: { ...process.env, VIRTUAL_ENV: BASE_VENV_PATH }
      })

      this.baseEnvReady = true
      console.log('[RuntimeService] Base environment ready')
      return { ready: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error('[RuntimeService] Failed to set up base env:', error)
      return { ready: false, error }
    }
  }

  /** Install additional packages into the shared base env */
  async installPackages(packages: string[]): Promise<{ success: boolean; error?: string }> {
    const baseReady = await this.ensureBaseEnv()
    if (!baseReady.ready) {
      return { success: false, error: `Base env not ready: ${baseReady.error}` }
    }

    try {
      await execFileAsync(this.uvPath!, ['pip', 'install', ...packages], {
        cwd: BASE_ENV_DIR,
        timeout: 120_000,
        env: { ...process.env, VIRTUAL_ENV: BASE_VENV_PATH }
      })

      // Track non-default packages for session-based cleanup
      this.trackPackageUsage(packages)

      auditLogger.log({
        type: 'ipc:sensitive_call',
        action: 'runtime:packages_installed',
        details: { packages: packages.join(', '), target: 'base_env' },
        success: true
      })

      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { success: false, error }
    }
  }

  // ── Working Folder venv Detection ────────────────────────────────────────

  /** Find the Python binary for a working folder (project venv or base env) */
  private async getPythonForCwd(cwd?: string): Promise<{ python: string; venvPath: string }> {
    // Check if working folder has its own venv
    if (cwd && existsSync(cwd)) {
      const projectVenvPaths = [
        join(cwd, '.venv', 'bin', 'python'),
        join(cwd, 'venv', 'bin', 'python'),
        join(cwd, '.venv', 'Scripts', 'python.exe'),
        join(cwd, 'venv', 'Scripts', 'python.exe')
      ]
      for (const p of projectVenvPaths) {
        if (existsSync(p)) {
          const venvDir = join(p, '..', '..')
          console.log(`[RuntimeService] Using project venv at ${venvDir}`)
          return { python: p, venvPath: join(p, '..', '..') }
        }
      }
    }

    // Fall back to shared base env
    await this.ensureBaseEnv()
    const basePython =
      platform() === 'win32'
        ? join(BASE_VENV_PATH, 'Scripts', 'python.exe')
        : join(BASE_VENV_PATH, 'bin', 'python')
    return { python: basePython, venvPath: BASE_VENV_PATH }
  }

  // ── Script Execution ─────────────────────────────────────────────────────

  async runScript(options: {
    runtime: 'python' | 'javascript'
    code: string
    packages?: string[]
    cwd?: string
    timeoutMs?: number
    env?: Record<string, string>
  }): Promise<ScriptResult> {
    const { runtime, code, packages, cwd, env } = options
    const timeoutMs = Math.min(
      Math.max(options.timeoutMs || DEFAULT_SCRIPT_TIMEOUT_MS, 1000),
      MAX_SCRIPT_TIMEOUT_MS
    )

    auditLogger.log({
      type: 'ipc:sensitive_call',
      action: 'runtime:script_run',
      details: {
        runtime,
        packages: packages?.join(', ') || 'none',
        codeLength: code.length,
        cwd: cwd || 'base_env'
      },
      success: true
    })

    if (runtime === 'python') {
      return await this.runPythonScript(code, packages || [], cwd, timeoutMs, env)
    } else {
      return await this.runJavaScriptScript(code, cwd, timeoutMs, env)
    }
  }

  private async runPythonScript(
    code: string,
    packages: string[],
    cwd?: string,
    timeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
    env?: Record<string, string>
  ): Promise<ScriptResult> {
    // Install any extra packages into the base env first
    if (packages.length > 0) {
      const installResult = await this.installPackages(packages)
      if (!installResult.success) {
        return {
          success: false,
          stdout: '',
          stderr: '',
          error: `Failed to install packages: ${installResult.error}`
        }
      }
    } else {
      // Still ensure base env is ready even without extra packages
      const baseReady = await this.ensureBaseEnv()
      if (!baseReady.ready) {
        return {
          success: false,
          stdout: '',
          stderr: '',
          error: `Python runtime not available: ${baseReady.error}`
        }
      }
    }

    const { python, venvPath } = await this.getPythonForCwd(cwd)

    // Write script to a temp file in the execution directory
    const execDir = cwd && existsSync(cwd) ? cwd : BASE_ENV_DIR
    const scriptFile = join(execDir, `_overlay_run_${Date.now()}.py`)
    writeFileSync(scriptFile, code, 'utf-8')

    try {
      const { stdout, stderr } = await execFileAsync(python, [scriptFile], {
        cwd: execDir,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, ...env, VIRTUAL_ENV: venvPath }
      })

      return {
        success: true,
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 10_000),
        exitCode: 0
      }
    } catch (err: unknown) {
      const error = err as {
        code?: string
        killed?: boolean
        stdout?: string
        stderr?: string
        status?: number
      }
      const timedOut = error.killed === true || error.code === 'ERR_CHILD_PROCESS_TIMEOUT'
      return {
        success: false,
        stdout: (error.stdout || '').slice(0, 50_000),
        stderr: (error.stderr || '').slice(0, 10_000),
        exitCode: error.status ?? undefined,
        timedOut,
        error: timedOut ? 'Script timed out' : (error.stderr || '').slice(0, 2000)
      }
    } finally {
      // Clean up temp script file
      try {
        rmSync(scriptFile, { force: true })
      } catch {
        // ignore
      }
    }
  }

  private async runJavaScriptScript(
    code: string,
    cwd?: string,
    timeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
    env?: Record<string, string>
  ): Promise<ScriptResult> {
    const execDir = cwd && existsSync(cwd) ? cwd : BASE_ENV_DIR
    const scriptFile = join(execDir, `_overlay_run_${Date.now()}.mjs`)
    writeFileSync(scriptFile, code, 'utf-8')

    const nodePath = process.execPath

    try {
      const { stdout, stderr } = await execFileAsync(nodePath, [scriptFile], {
        cwd: execDir,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, ...env, NODE_NO_WARNINGS: '1' }
      })

      return {
        success: true,
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 10_000),
        exitCode: 0
      }
    } catch (err: unknown) {
      const error = err as {
        code?: string
        killed?: boolean
        stdout?: string
        stderr?: string
        status?: number
      }
      const timedOut = error.killed === true || error.code === 'ERR_CHILD_PROCESS_TIMEOUT'
      return {
        success: false,
        stdout: (error.stdout || '').slice(0, 50_000),
        stderr: (error.stderr || '').slice(0, 10_000),
        exitCode: error.status ?? undefined,
        timedOut,
        error: timedOut ? 'Script timed out' : (error.stderr || '').slice(0, 2000)
      }
    } finally {
      try {
        rmSync(scriptFile, { force: true })
      } catch {
        // ignore
      }
    }
  }

  // ── Session-based Cleanup ────────────────────────────────────────────────

  /**
   * Remove non-default packages that haven't been used for STALE_SESSION_THRESHOLD sessions.
   * Called on app startup after session increment.
   */
  async cleanup(): Promise<number> {
    const currentSession = this.packageTracker.sessionNumber
    const stalePackages: string[] = []

    for (const [pkg, lastUsed] of Object.entries(this.packageTracker.packages)) {
      if (currentSession - lastUsed >= STALE_SESSION_THRESHOLD) {
        stalePackages.push(pkg)
      }
    }

    if (stalePackages.length === 0) return 0

    console.log(
      `[RuntimeService] Cleaning up ${stalePackages.length} stale package(s): ${stalePackages.join(', ')}`
    )

    if (!this.isUvInstalled() || !existsSync(BASE_VENV_PATH)) {
      // Can't uninstall without uv/venv — just remove from tracker
      for (const pkg of stalePackages) {
        delete this.packageTracker.packages[pkg]
      }
      this.savePackageTracker()
      return stalePackages.length
    }

    try {
      await execFileAsync(this.uvPath!, ['pip', 'uninstall', '-y', ...stalePackages], {
        cwd: BASE_ENV_DIR,
        timeout: 60_000,
        env: { ...process.env, VIRTUAL_ENV: BASE_VENV_PATH }
      })
    } catch (err) {
      console.error('[RuntimeService] Failed to uninstall stale packages:', err)
    }

    // Remove from tracker regardless of uninstall success
    for (const pkg of stalePackages) {
      delete this.packageTracker.packages[pkg]
    }
    this.savePackageTracker()

    auditLogger.log({
      type: 'ipc:sensitive_call',
      action: 'runtime:stale_packages_cleaned',
      details: { packages: stalePackages.join(', '), count: stalePackages.length },
      success: true
    })

    return stalePackages.length
  }

  /** Get info about the base environment */
  getBaseEnvInfo(): {
    path: string
    venvPath: string
    ready: boolean
    defaultPackages: string[]
    trackedPackages: Record<string, number>
    sessionNumber: number
  } {
    return {
      path: BASE_ENV_DIR,
      venvPath: BASE_VENV_PATH,
      ready: this.baseEnvReady,
      defaultPackages: [...DEFAULT_PACKAGES],
      trackedPackages: { ...this.packageTracker.packages },
      sessionNumber: this.packageTracker.sessionNumber
    }
  }
}

export const runtimeService = new RuntimeService()
