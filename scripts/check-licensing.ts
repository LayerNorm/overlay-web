import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type PackageJson = {
  name?: string
  license?: string
}

type PackageLockPackage = {
  license?: string
  licenses?: Array<string | { type?: string }> | string
  dev?: boolean
  devOptional?: boolean
}

type PackageLock = {
  packages?: Record<string, PackageLockPackage>
}

type LicenseException = {
  package: string
  licenses: string[]
  reason: string
}

type LicenseAllowlist = {
  runtimeLicenseExceptions: LicenseException[]
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const agplLicense = 'AGPL-3.0-or-later'
const apacheLicense = 'Apache-2.0'

const agplPackageJsonPaths = [
  'package.json',
  'overlay-desktop/package.json',
  'overlay-mobile/package.json',
  'overlay-chrome/package.json',
]

const requiredDocs = [
  'LICENSE.md',
  'NOTICE.md',
  'TRADEMARKS.md',
  'docs/legal/licensing.mdx',
  'docs/legal/self-hosting-obligations.mdx',
]

const requiredDocSnippets = [
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'commercial license',
  'trademark',
  'self-host',
]

const allowedLicenseIds = new Set([
  '0BSD',
  'AFL-2.1',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
])

async function main() {
  const failures: string[] = []

  for (const packagePath of agplPackageJsonPaths) {
    await checkPackageLicense(packagePath, agplLicense, failures)
  }

  const apachePackagePaths = await listApachePackageJsonPaths()
  for (const packagePath of apachePackagePaths) {
    await checkPackageLicense(packagePath, apacheLicense, failures)
  }

  await checkRequiredDocs(failures)
  await checkRuntimeDependencyLicenses(failures)

  if (failures.length > 0) {
    console.error('FAIL license:check')
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }

  console.log(
    `OK license:check: ${agplPackageJsonPaths.length} AGPL product manifests, ` +
      `${apachePackagePaths.length} Apache package manifests, required docs, and runtime dependency licenses verified.`,
  )
}

async function listApachePackageJsonPaths(): Promise<string[]> {
  const packageDirs = await readdir(path.join(root, 'packages'), { withFileTypes: true })
  const packageJsonPaths: string[] = []

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) continue
    const packageJsonPath = `packages/${entry.name}/package.json`
    if (await fileExists(packageJsonPath)) packageJsonPaths.push(packageJsonPath)
  }

  packageJsonPaths.push('overlay-chrome/packages/overlay-extension-contracts/package.json')
  return packageJsonPaths.sort()
}

async function checkPackageLicense(packagePath: string, expectedLicense: string, failures: string[]) {
  const packageJson = await readJson<PackageJson>(packagePath)
  if (packageJson.license !== expectedLicense) {
    failures.push(
      `${packagePath} (${packageJson.name ?? 'unnamed package'}) must declare license ${expectedLicense}; found ${packageJson.license ?? 'missing'}`,
    )
  }
}

async function checkRequiredDocs(failures: string[]) {
  const docs: string[] = []
  for (const docPath of requiredDocs) {
    const absolutePath = path.join(root, docPath)
    try {
      await access(absolutePath)
      docs.push(await readFile(absolutePath, 'utf8'))
    } catch {
      failures.push(`${docPath} is required for the split-license policy`)
    }
  }

  const combinedDocs = docs.join('\n').toLowerCase()
  for (const snippet of requiredDocSnippets) {
    if (!combinedDocs.includes(snippet.toLowerCase())) {
      failures.push(`licensing docs must mention "${snippet}"`)
    }
  }
}

async function checkRuntimeDependencyLicenses(failures: string[]) {
  const lockfile = await readJson<PackageLock>('package-lock.json')
  const allowlist = await readJson<LicenseAllowlist>('scripts/license-allowlist.json')
  const usedExceptions = new Set<LicenseException>()
  let audited = 0

  for (const [packagePath, metadata] of Object.entries(lockfile.packages ?? {})) {
    if (!isThirdPartyRuntimePackage(packagePath, metadata)) continue
    audited += 1

    const packageName = packageNameFromLockPath(packagePath)
    const license = stringifyLicense(metadata.license ?? metadata.licenses)
    if (isAcceptableLicenseExpression(license)) continue

    const exception = findLicenseException(packageName, license, allowlist.runtimeLicenseExceptions)
    if (exception) {
      usedExceptions.add(exception)
      continue
    }

    failures.push(`${packagePath} declares risky or unknown license "${license}" without an allowlist entry`)
  }

  for (const exception of allowlist.runtimeLicenseExceptions) {
    if (!usedExceptions.has(exception)) {
      failures.push(`unused license allowlist entry for ${exception.package}`)
    }
    if (!exception.reason.trim()) {
      failures.push(`license allowlist entry for ${exception.package} must include a reason`)
    }
  }

  if (audited === 0) failures.push('package-lock.json did not contain any runtime dependencies to audit')
}

function isThirdPartyRuntimePackage(packagePath: string, metadata: PackageLockPackage): boolean {
  return (
    packagePath.startsWith('node_modules/') &&
    !packagePath.startsWith('node_modules/@overlay/') &&
    metadata.dev !== true &&
    metadata.devOptional !== true
  )
}

function stringifyLicense(license: PackageLockPackage['license'] | PackageLockPackage['licenses']): string {
  if (!license) return 'MISSING'
  if (typeof license === 'string') return license
  return license
    .map((entry) => (typeof entry === 'string' ? entry : entry.type))
    .filter((entry): entry is string => Boolean(entry))
    .join(' OR ') || 'MISSING'
}

function isAcceptableLicenseExpression(licenseExpression: string): boolean {
  const expression = stripOuterParens(licenseExpression.trim())
  if (!expression || expression === 'MISSING') return false

  const orParts = expression.split(/\s+OR\s+/i).map((part) => stripOuterParens(part.trim()))
  if (orParts.length > 1) {
    return orParts.some((part) => isAcceptableLicenseExpression(part))
  }

  const andParts = expression.split(/\s+AND\s+/i).map((part) => stripOuterParens(part.trim()))
  if (andParts.length > 1) {
    return andParts.every((part) => isAcceptableLicenseExpression(part))
  }

  return allowedLicenseIds.has(expression)
}

function stripOuterParens(value: string): string {
  let current = value.trim()
  while (current.startsWith('(') && current.endsWith(')')) {
    current = current.slice(1, -1).trim()
  }
  return current
}

function findLicenseException(
  packageName: string,
  license: string,
  exceptions: LicenseException[],
): LicenseException | undefined {
  return exceptions.find((exception) => {
    return matchesPackagePattern(packageName, exception.package) && exception.licenses.includes(license)
  })
}

function matchesPackagePattern(packageName: string, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`)
  return regex.test(packageName)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function packageNameFromLockPath(packagePath: string): string {
  const lastNodeModulesSegment = packagePath.split('node_modules/').filter(Boolean).pop()
  if (!lastNodeModulesSegment) return packagePath

  const parts = lastNodeModulesSegment.split('/')
  if (parts[0]?.startsWith('@')) return `${parts[0]}/${parts[1]}`
  return parts[0] ?? lastNodeModulesSegment
}

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8')) as T
}

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
