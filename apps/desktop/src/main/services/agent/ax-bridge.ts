import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

function getAxHelperPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'ax-helper'),
    join(app.getAppPath(), 'resources', 'ax-helper'),
    join(__dirname, '..', '..', '..', 'resources', 'ax-helper')
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

export async function runAxHelper(args: string[]): Promise<unknown> {
  const helperPath = getAxHelperPath()
  if (helperPath) {
    const { stdout } = await execFileAsync(helperPath, args, { timeout: 8000 })
    return JSON.parse(stdout)
  }
  // Fallback: run via swift interpreter (dev convenience — slower)
  const swiftSrc = join(app.getAppPath(), 'ax-helper', 'ax-helper.swift')
  if (existsSync(swiftSrc)) {
    const { stdout } = await execFileAsync('swift', [swiftSrc, ...args], { timeout: 20000 })
    return JSON.parse(stdout)
  }
  throw new Error('ax-helper binary not found. Run: bash scripts/build-ax-helper.sh')
}
