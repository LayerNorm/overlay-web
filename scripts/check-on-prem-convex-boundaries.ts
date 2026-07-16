import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

type ScheduledJob = {
  cadence: string
  name: string
  target: string
}

type Baseline = {
  version: 2
  apiRouteFiles: string[]
  browserRuntimeFiles: string[]
  convexCronJobs: ScheduledJob[]
  convexRuntimeImportFiles: string[]
  convexScheduledCallFiles: string[]
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(root, 'config/on-prem-convex-runtime-baseline.json')
const runtimeSourceRoots = ['src', 'packages', 'workers'].map((directory) => path.join(root, directory))
const convexRoot = path.join(root, 'convex')
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])

function isRuntimeSource(file: string): boolean {
  const normalized = file.replaceAll(path.sep, '/')
  return sourceExtensions.has(path.extname(file)) &&
    !/\.(?:test|spec|stories)\.[^.]+$/.test(normalized) &&
    !normalized.includes('/__tests__/') &&
    !normalized.includes('/_generated/')
}

function isConvexSpecifier(specifier: string): boolean {
  const normalized = specifier.toLowerCase()
  return normalized === 'convex' ||
    normalized.startsWith('convex/') ||
    normalized.startsWith('@convex-dev/') ||
    normalized.includes('/convex') ||
    normalized.includes('convex-') ||
    normalized.includes('lazy-convex')
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectFiles(absolute)
    return isRuntimeSource(absolute) ? [absolute] : []
  }))
  return nested.flat()
}

function parseSource(file: string, source: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') || file.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
}

function runtimeModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = []

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (isRuntimeImportDeclaration(node)) specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly && !allExportsAreTypeOnly(node)) specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const [firstArg] = node.arguments
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if ((isDynamicImport || isRequire) && firstArg && ts.isStringLiteral(firstArg)) {
        specifiers.push(firstArg.text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function isRuntimeImportDeclaration(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) return true
  if (clause.isTypeOnly) return false
  if (clause.name) return true
  if (!clause.namedBindings) return true
  if (ts.isNamespaceImport(clause.namedBindings)) return true
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly)
}

function allExportsAreTypeOnly(node: ts.ExportDeclaration): boolean {
  return Boolean(
    node.exportClause &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly),
  )
}

async function createBaseline(): Promise<Baseline> {
  const runtimeFiles = (await Promise.all(runtimeSourceRoots.map(collectFiles))).flat()
  const convexRuntimeImportFiles: string[] = []
  const browserRuntimeFiles: string[] = []

  for (const file of runtimeFiles) {
    const source = await readFile(file, 'utf8')
    const specifiers = runtimeModuleSpecifiers(parseSource(file, source))
    if (!specifiers.some(isConvexSpecifier)) continue

    const relative = relativePath(file)
    convexRuntimeImportFiles.push(relative)
    if (relative.startsWith('src/components/') || relative.startsWith('src/features/')) {
      browserRuntimeFiles.push(relative)
    }
  }

  const apiRouteFiles = (await collectFiles(path.join(root, 'src/app/api')))
    .filter((file) => path.basename(file) === 'route.ts')
    .map(relativePath)
    .sort()
  const convexFiles = await collectFiles(convexRoot)

  return {
    version: 2,
    apiRouteFiles,
    browserRuntimeFiles: browserRuntimeFiles.sort(),
    convexCronJobs: await readConvexCronJobs(),
    convexRuntimeImportFiles: convexRuntimeImportFiles.sort(),
    convexScheduledCallFiles: await scheduledCallFiles(convexFiles),
  }
}

async function readConvexCronJobs(): Promise<ScheduledJob[]> {
  const file = path.join(convexRoot, 'crons.ts')
  const source = await readFile(file, 'utf8')
  const sourceFile = parseSource(file, source)
  const jobs: ScheduledJob[] = []

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression
      const method = node.expression.name.text
      const [name, cadence, target] = node.arguments
      if (
        ts.isIdentifier(receiver) &&
        receiver.text === 'crons' &&
        ['cron', 'daily', 'hourly', 'interval', 'monthly', 'weekly'].includes(method) &&
        name && ts.isStringLiteral(name) && cadence && target
      ) {
        jobs.push({
          cadence: normalizeSourceText(cadence.getText(sourceFile)),
          name: name.text,
          target: normalizeSourceText(target.getText(sourceFile)),
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return jobs.sort((left, right) => left.name.localeCompare(right.name))
}

async function scheduledCallFiles(files: string[]): Promise<string[]> {
  const scheduled = new Set<string>()
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const sourceFile = parseSource(file, source)

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ['runAfter', 'runAt'].includes(node.expression.name.text) &&
        node.expression.expression.getText(sourceFile).endsWith('.scheduler')
      ) {
        scheduled.add(relativePath(file))
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }
  return [...scheduled].sort()
}

function normalizeSourceText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function relativePath(file: string): string {
  return path.relative(root, file).replaceAll(path.sep, '/')
}

function reportStringListDiff(label: string, expected: string[], actual: string[]): boolean {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const added = actual.filter((value) => !expectedSet.has(value))
  const removed = expected.filter((value) => !actualSet.has(value))
  if (!added.length && !removed.length) return false

  console.error(`${label} changed.`)
  for (const value of added) console.error(`  added: ${value}`)
  for (const value of removed) console.error(`  removed: ${value}`)
  return true
}

function reportCronDiff(expected: ScheduledJob[], actual: ScheduledJob[]): boolean {
  const expectedValues = expected.map((job) => JSON.stringify(job))
  const actualValues = actual.map((job) => JSON.stringify(job))
  return reportStringListDiff('Convex cron job inventory', expectedValues, actualValues)
}

async function main(): Promise<void> {
  const actual = await createBaseline()
  if (process.env.UPDATE_ON_PREM_CONVEX_BASELINE === '1') {
    await writeFile(baselinePath, `${JSON.stringify(actual, null, 2)}\n`, 'utf8')
    console.log(
      `Updated ${relativePath(baselinePath)} with ${actual.apiRouteFiles.length} API routes, ` +
      `${actual.convexRuntimeImportFiles.length} Convex runtime imports, ` +
      `${actual.browserRuntimeFiles.length} browser touchpoints, ${actual.convexCronJobs.length} cron jobs, ` +
      `and ${actual.convexScheduledCallFiles.length} scheduler call sites.`,
    )
    return
  }

  const expected = JSON.parse(await readFile(baselinePath, 'utf8')) as Baseline
  if (expected.version !== 2) {
    throw new Error('Unsupported on-prem Convex runtime baseline version. Regenerate version 2 after review.')
  }

  const changed = [
    reportStringListDiff('API route inventory', expected.apiRouteFiles, actual.apiRouteFiles),
    reportStringListDiff('Browser Convex runtime inventory', expected.browserRuntimeFiles, actual.browserRuntimeFiles),
    reportStringListDiff(
      'Convex runtime import inventory',
      expected.convexRuntimeImportFiles,
      actual.convexRuntimeImportFiles,
    ),
    reportStringListDiff(
      'Convex scheduler call-site inventory',
      expected.convexScheduledCallFiles,
      actual.convexScheduledCallFiles,
    ),
    reportCronDiff(expected.convexCronJobs, actual.convexCronJobs),
  ].some(Boolean)

  if (changed) {
    console.error(
      'Review the change, then run UPDATE_ON_PREM_CONVEX_BASELINE=1 ' +
      'npm run check:on-prem-convex-boundaries.',
    )
    process.exit(1)
  }

  console.log(
    `OK on-prem inventory: ${actual.apiRouteFiles.length} API routes, ` +
    `${actual.convexRuntimeImportFiles.length} Convex runtime imports, ` +
    `${actual.browserRuntimeFiles.length} browser touchpoints, ${actual.convexCronJobs.length} cron jobs, ` +
    `and ${actual.convexScheduledCallFiles.length} scheduler call sites are tracked.`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
