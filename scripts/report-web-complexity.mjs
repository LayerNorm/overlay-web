#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
const REPORT_PATH = path.join(ROOT, 'internal-docs/reports/web-app-complexity-report.html')
const BASELINE_PATH = path.join(ROOT, 'internal-docs/reports/web-app-complexity-baseline.json')
const BUDGET_CONFIG_PATH = path.join(ROOT, 'internal-docs/reports/web-complexity-budgets.json')

const args = new Set(process.argv.slice(2))
const shouldCheck = args.has('--check')
const shouldUpdateBaseline = args.has('--update-baseline')
const shouldSkipHtml = args.has('--no-html')
const shouldPrintJson = args.has('--json')

const INCLUDE_ROOTS = ['src', 'packages']
const EXCLUDED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
])
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss'])
const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const DEFAULT_BUDGETS = {
  maxProductionFileLoc: 500,
  maxFunctionComplexity: 25,
  maxRouteHandlerLoc: 250,
  monolithFileLocBudgets: {},
  allowedExactDuplicateGroups: [
    [
      'src/sentry.edge.config.ts',
      'src/sentry.server.config.ts',
    ],
  ],
  zeroFanInOverrides: {},
}

const BUDGETS = loadBudgetConfig()

function loadBudgetConfig() {
  if (!fs.existsSync(BUDGET_CONFIG_PATH)) return DEFAULT_BUDGETS
  const parsed = JSON.parse(fs.readFileSync(BUDGET_CONFIG_PATH, 'utf8'))
  return {
    ...DEFAULT_BUDGETS,
    ...parsed,
    monolithFileLocBudgets:
      parsed.monolithFileLocBudgets || DEFAULT_BUDGETS.monolithFileLocBudgets,
    allowedExactDuplicateGroups:
      parsed.allowedExactDuplicateGroups || DEFAULT_BUDGETS.allowedExactDuplicateGroups,
    zeroFanInOverrides:
      parsed.zeroFanInOverrides || DEFAULT_BUDGETS.zeroFanInOverrides,
  }
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/')
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function fmt(value) {
  return Number(value || 0).toLocaleString('en-US')
}

function hash(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function isDirectoryExcluded(name) {
  return EXCLUDED_DIRS.has(name)
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue
    if (entry.isDirectory()) {
      if (!isDirectoryExcluded(entry.name)) walk(path.join(dir, entry.name), out)
      continue
    }
    if (entry.isFile()) out.push(path.join(dir, entry.name))
  }
  return out
}

function isTestOrStory(file) {
  return (
    /(^|\/)(__tests__|__mocks__|test|tests|fixtures)(\/|$)/.test(file) ||
    /\.(test|spec)\.[cm]?[tj]sx?$/.test(file) ||
    /\.stories\.[cm]?[tj]sx?$/.test(file)
  )
}

function classifyLayer(file) {
  if (file.startsWith('src/app/api/v1/')) return 'src/app/api/v1 wrappers'
  if (file.startsWith('src/app/api/')) return 'src/app/api other'
  if (file.startsWith('src/app/')) return 'src/app routes'
  if (file.startsWith('src/server/app-api/v1/')) return 'src/server/app-api/v1 handlers'
  if (file.startsWith('src/server/')) return 'src/server'
  if (file.startsWith('src/shared/')) return 'src/shared'
  if (file.startsWith('src/features/')) return 'src/features'
  if (file.startsWith('src/components/')) return 'src/components'
  if (file.startsWith('src/hooks/')) return 'src/hooks'
  if (file.startsWith('src/contexts/')) return 'src/contexts'
  if (file.startsWith('packages/')) return file.split('/').slice(0, 2).join('/')
  return 'other'
}

function countLoc(text, extension) {
  const lines = text.split(/\r?\n/)
  let blank = 0
  let comment = 0
  let code = 0
  let inBlock = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      blank += 1
      continue
    }

    if (inBlock) {
      comment += 1
      if (trimmed.includes('*/')) inBlock = false
      continue
    }

    if (CODE_EXTENSIONS.has(extension)) {
      if (trimmed.startsWith('/*')) {
        comment += 1
        if (!trimmed.includes('*/')) inBlock = true
        continue
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        comment += 1
        continue
      }
    }

    code += 1
  }

  return { total: lines.length, blank, comment, code }
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  )
}

function functionName(node) {
  if (node.name) return node.name.getText()
  const parent = node.parent
  if (parent && ts.isVariableDeclaration(parent) && parent.name) return parent.name.getText()
  if (parent && ts.isPropertyAssignment(parent) && parent.name) return parent.name.getText()
  if (parent && ts.isExportAssignment(parent)) return 'default export'
  return 'callback'
}

function decisionCost(node) {
  if (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isCaseClause(node) ||
    ts.isCatchClause(node) ||
    ts.isConditionalExpression(node)
  ) {
    return 1
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind
    if (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return 1
    }
  }
  return 0
}

function complexityForFunction(node) {
  let score = 1
  function visit(child) {
    if (child !== node && isFunctionLike(child)) return
    score += decisionCost(child)
    ts.forEachChild(child, visit)
  }
  visit(node.body || node)
  return score
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function isRouteHandler(file) {
  return (
    /^src\/app\/api\/.+\/route\.[cm]?[tj]s$/.test(file) ||
    /^src\/server\/app-api\/v1\/.+\/route\.[cm]?[tj]s$/.test(file)
  )
}

function isNextEntrypoint(file) {
  return (
    file.startsWith('src/app/') &&
    /(^|\/)(page|layout|loading|route|template|error|global-error|not-found|default|opengraph-image|twitter-image|icon)\.[cm]?[tj]sx?$/.test(file)
  )
}

function isOtherFrameworkEntrypoint(file) {
  return /^src\/(middleware|instrumentation|instrumentation-client|proxy)\.[cm]?[tj]sx?$/.test(file)
}

function isPackagePublicEntrypoint(file) {
  return /^packages\/[^/]+\/src\/index\.[cm]?[tj]sx?$/.test(file)
}

function zeroFanInOverride(file) {
  return BUDGETS.zeroFanInOverrides?.[file] || null
}

function classifyZeroFanInFile(file) {
  const override = zeroFanInOverride(file)
  if (override) return override
  if (isNextEntrypoint(file) || isOtherFrameworkEntrypoint(file)) {
    return {
      classification: 'keep',
      reason: 'Framework entrypoint discovered by file-system routing or runtime hooks.',
    }
  }
  if (isPackagePublicEntrypoint(file)) {
    return {
      classification: 'keep',
      reason: 'Package public API barrel; consumers may import it through package exports.',
    }
  }
  if (/\/(postcss|tailwind|eslint|vite|next)\.config\.[cm]?js$/.test(file)) {
    return {
      classification: 'keep',
      reason: 'Tooling config loaded outside the application import graph.',
    }
  }
  return {
    classification: 'review',
    reason: 'No static fan-in found. Classify as keep, merge, or delete before changing.',
  }
}

function importResolver(files) {
  const fileSet = new Set(files)
  const byNoExtension = new Map()
  const byDirectoryIndex = new Map()

  for (const file of files) {
    const noExtension = file.replace(/\.[^.]+$/, '')
    byNoExtension.set(noExtension, file)
    if (/\/index\.[^.]+$/.test(file)) {
      byDirectoryIndex.set(file.replace(/\/index\.[^.]+$/, ''), file)
    }
  }

  function resolveBase(base) {
    if (fileSet.has(base)) return base
    return byNoExtension.get(base) || byDirectoryIndex.get(base) || null
  }

  return function resolveImport(specifier, fromFile) {
    let base
    if (specifier.startsWith('.')) {
      base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
    } else if (specifier.startsWith('@/')) {
      base = `src/${specifier.slice(2)}`
    } else if (specifier.startsWith('@overlay/')) {
      const [packageName, ...subpath] = specifier.slice('@overlay/'.length).split('/')
      base = `packages/overlay-${packageName}/src${subpath.length ? `/${subpath.join('/')}` : ''}`
    } else {
      return null
    }
    return resolveBase(base)
  }
}

function importedSpecifiers(sourceFile) {
  const specifiers = []
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function canonicalGroup(files) {
  return files.slice().sort().join('|')
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
}

function collectMetrics() {
  const allFiles = INCLUDE_ROOTS
    .flatMap((entry) => walk(path.join(ROOT, entry)))
    .filter((filePath) => CODE_EXTENSIONS.has(path.extname(filePath)))

  const files = []
  const functions = []
  const duplicateMap = new Map()
  const scriptFiles = allFiles
    .map(relativePath)
    .filter((file) => SCRIPT_EXTENSIONS.has(path.extname(file)) && !file.endsWith('.d.ts'))
  const resolveImport = importResolver(scriptFiles)
  const inboundByFile = new Map(scriptFiles.map((file) => [file, new Set()]))

  for (const filePath of allFiles) {
    const file = relativePath(filePath)
    const extension = path.extname(filePath)
    const text = fs.readFileSync(filePath, 'utf8')
    const loc = countLoc(text, extension)
    const isTest = isTestOrStory(file)
    const layer = classifyLayer(file)
    const record = {
      file,
      extension,
      layer,
      isTest,
      bytes: Buffer.byteLength(text),
      loc,
      complexity: 0,
      functionCount: 0,
    }

    if (!isTest) {
      const group = duplicateMap.get(hash(text.trim())) || []
      group.push(file)
      duplicateMap.set(hash(text.trim()), group)
    }

    if (SCRIPT_EXTENSIONS.has(extension) && !file.endsWith('.d.ts')) {
      const scriptKind = extension === '.tsx' || extension === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind)
      let fileComplexity = 1
      let functionCount = 0

      for (const specifier of importedSpecifiers(sourceFile)) {
        const target = resolveImport(specifier, file)
        if (target && target !== file) inboundByFile.get(target)?.add(file)
      }

      function visit(node) {
        fileComplexity += decisionCost(node)
        if (isFunctionLike(node)) {
          functionCount += 1
          const startLine = lineOf(sourceFile, node)
          const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1
          functions.push({
            file,
            name: functionName(node),
            line: startLine,
            loc: endLine - startLine + 1,
            complexity: complexityForFunction(node),
            isTest,
          })
        }
        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
      record.complexity = fileComplexity
      record.functionCount = functionCount
    }

    files.push(record)
  }

  const productionFiles = files.filter((file) => !file.isTest)
  const duplicateGroups = [...duplicateMap.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.slice().sort())
    .sort((a, b) => b.length - a.length || canonicalGroup(a).localeCompare(canonicalGroup(b)))

  const largeProductionFiles = productionFiles
    .filter((file) => file.loc.code > BUDGETS.maxProductionFileLoc)
    .map((file) => file.file)
    .sort()

  const complexFunctions = functions
    .filter((fn) => !fn.isTest && fn.complexity > BUDGETS.maxFunctionComplexity)
    .map((fn) => ({
      key: `${fn.file}#${fn.name}`,
      file: fn.file,
      name: fn.name,
      line: fn.line,
      complexity: fn.complexity,
      loc: fn.loc,
    }))
    .sort((a, b) => b.complexity - a.complexity || a.file.localeCompare(b.file))

  const routeHandlersOverBudget = productionFiles
    .filter((file) => isRouteHandler(file.file) && file.loc.code > BUDGETS.maxRouteHandlerLoc)
    .map((file) => file.file)
    .sort()

  const zeroFanInFiles = productionFiles
    .filter((file) =>
      SCRIPT_EXTENSIONS.has(file.extension) &&
      !file.file.endsWith('.d.ts') &&
      (inboundByFile.get(file.file)?.size ?? 0) === 0
    )
    .map((file) => ({
      file: file.file,
      layer: file.layer,
      loc: file.loc.code,
      ...classifyZeroFanInFile(file.file),
    }))
    .sort((a, b) =>
      a.classification.localeCompare(b.classification) ||
      a.file.localeCompare(b.file),
    )

  const totals = files.reduce(
    (acc, file) => {
      acc.files += 1
      acc.code += file.loc.code
      acc.total += file.loc.total
      if (file.isTest) {
        acc.testFiles += 1
        acc.testCode += file.loc.code
      } else {
        acc.productionFiles += 1
        acc.productionCode += file.loc.code
      }
      return acc
    },
    {
      files: 0,
      code: 0,
      total: 0,
      productionFiles: 0,
      productionCode: 0,
      testFiles: 0,
      testCode: 0,
    },
  )

  return {
    generatedAt: new Date().toISOString(),
    budgets: BUDGETS,
    totals,
    files,
    functions,
    duplicateGroups,
    largeProductionFiles,
    complexFunctions,
    routeHandlersOverBudget,
    zeroFanInFiles,
  }
}

function buildBaseline(metrics) {
  const functionCounts = {}
  for (const fn of metrics.complexFunctions) {
    functionCounts[fn.key] = (functionCounts[fn.key] || 0) + 1
  }
  return {
    generatedAt: metrics.generatedAt,
    budgets: BUDGETS,
    allowedExactDuplicateGroups: BUDGETS.allowedExactDuplicateGroups.map(canonicalGroup),
    largeProductionFiles: metrics.largeProductionFiles,
    complexFunctionCounts: functionCounts,
    routeHandlersOverBudget: metrics.routeHandlersOverBudget,
    zeroFanInFiles: metrics.zeroFanInFiles,
    totals: metrics.totals,
  }
}

function compareAgainstBaseline(metrics, baseline) {
  const errors = []
  const allowedDuplicateGroups = new Set([
    ...(baseline?.allowedExactDuplicateGroups || []),
    ...BUDGETS.allowedExactDuplicateGroups.map(canonicalGroup),
  ])

  for (const group of metrics.duplicateGroups) {
    const key = canonicalGroup(group)
    if (!allowedDuplicateGroups.has(key)) {
      errors.push(`Exact duplicate production files are not allowed: ${group.join(', ')}`)
    }
  }

  const baselineLargeFiles = new Set(baseline?.largeProductionFiles || [])
  for (const file of metrics.largeProductionFiles) {
    if (!baselineLargeFiles.has(file)) {
      errors.push(`New production file over ${BUDGETS.maxProductionFileLoc} LOC: ${file}`)
    }
  }

  const baselineRouteFiles = new Set(baseline?.routeHandlersOverBudget || [])
  for (const file of metrics.routeHandlersOverBudget) {
    if (!baselineRouteFiles.has(file)) {
      errors.push(`New route handler over ${BUDGETS.maxRouteHandlerLoc} LOC: ${file}`)
    }
  }

  const currentFunctionCounts = {}
  for (const fn of metrics.complexFunctions) {
    currentFunctionCounts[fn.key] = (currentFunctionCounts[fn.key] || 0) + 1
  }
  const baselineFunctionCounts = baseline?.complexFunctionCounts || {}
  for (const [key, count] of Object.entries(currentFunctionCounts)) {
    if (count > (baselineFunctionCounts[key] || 0)) {
      errors.push(`New function/component over complexity ${BUDGETS.maxFunctionComplexity}: ${key}`)
    }
  }

  const fileLocByPath = new Map(metrics.files.map((file) => [file.file, file.loc.code]))
  for (const [file, maxLoc] of Object.entries(BUDGETS.monolithFileLocBudgets || {})) {
    const loc = fileLocByPath.get(file)
    if (typeof loc === 'number' && loc > maxLoc) {
      errors.push(`Monolith file over ${maxLoc} LOC: ${file} (${loc})`)
    }
  }

  return errors
}

function groupByLayer(metrics) {
  const layers = new Map()
  for (const file of metrics.files) {
    const entry = layers.get(file.layer) || { files: 0, productionCode: 0, testCode: 0, code: 0 }
    entry.files += 1
    entry.code += file.loc.code
    if (file.isTest) entry.testCode += file.loc.code
    else entry.productionCode += file.loc.code
    layers.set(file.layer, entry)
  }
  return [...layers.entries()].sort((a, b) => b[1].code - a[1].code)
}

function table(headers, rows, renderRow) {
  return `<table><thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(renderRow).join('')}</tbody></table>`
}

function generateHtml(metrics, checkErrors) {
  const layers = groupByLayer(metrics)
  const largestFiles = metrics.files
    .filter((file) => !file.isTest)
    .sort((a, b) => b.loc.code - a.loc.code)
    .slice(0, 40)
  const highestComplexityFiles = metrics.files
    .filter((file) => !file.isTest)
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 40)
  const highestComplexityFunctions = metrics.complexFunctions.slice(0, 60)
  const zeroFanInCandidates = metrics.zeroFanInFiles
    .filter((file) => file.classification !== 'keep')
    .slice(0, 120)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Overlay Web App Complexity Report</title>
<style>
:root{--bg:#f7f7f3;--paper:#fff;--ink:#202124;--muted:#686b70;--line:#ddd9cf;--accent:#0e7c66;--warn:#ad6b00;--bad:#9b1c31;--good:#0d7a47;--chip:#efeee8;--shadow:0 12px 30px rgba(31,30,25,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.48 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1240px;margin:0 auto;padding:28px}.hero{padding:34px 0 20px;border-bottom:1px solid var(--line)}h1{margin:0;font-size:40px;line-height:1.05}h2{font-size:22px;margin:34px 0 12px}h3{font-size:16px;margin:0 0 12px}.note{color:var(--muted);max-width:900px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:24px 0}.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:16px;box-shadow:var(--shadow)}.metric .num{font-size:30px;font-weight:700}.label,.hint{color:var(--muted)}.hint{font-size:12px;margin-top:8px}.chip,.pill{display:inline-flex;align-items:center;border:1px solid var(--line);background:var(--chip);border-radius:999px;padding:4px 8px;margin:2px;color:#555}.chip{padding:6px 10px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b6254;background:#fbfaf6}.num{text-align:right;font-variant-numeric:tabular-nums}.path{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;word-break:break-all}.ok{color:var(--good);font-weight:700}.warn{color:var(--warn);font-weight:700}.bad{color:var(--bad);font-weight:700}.callout{border-left:4px solid var(--accent);padding:13px 14px;background:#f0f7f4;border-radius:6px;margin:12px 0}.callout.bad{border-color:var(--bad);background:#fff0f2}.callout.warn{border-color:var(--warn);background:#fff7e8}@media(max-width:900px){.grid,.two{grid-template-columns:1fr}.wrap{padding:18px}h1{font-size:30px}}
</style>
</head>
<body>
<div class="wrap">
<section class="hero">
<h1>Overlay Web App Complexity Report</h1>
<p class="note">Repeatable static complexity analysis for <code>src/**</code> and <code>packages/**</code>. This report is a ratchet baseline: existing known complexity is tracked, and <code>npm run check:web-complexity</code> blocks new exact duplicates, new over-large files, new over-complex functions, and new over-large route handlers.</p>
<div><span class="chip">Generated ${htmlEscape(metrics.generatedAt)}</span><span class="chip">Budget baseline ${htmlEscape(path.relative(ROOT, BASELINE_PATH))}</span><span class="chip">Budget config ${htmlEscape(path.relative(ROOT, BUDGET_CONFIG_PATH))}</span></div>
</section>

<section>
<h2>Budget Status</h2>
${checkErrors.length ? `<div class="callout bad"><strong>${fmt(checkErrors.length)} budget violation(s)</strong><ul>${checkErrors.map((error) => `<li>${htmlEscape(error)}</li>`).join('')}</ul></div>` : '<div class="callout"><strong>No new budget violations.</strong> Current over-budget items are captured by the baseline.</div>'}
<div class="grid">
<div class="card metric"><div class="num">${fmt(metrics.totals.code)}</div><div class="label">code LOC</div><div class="hint">${fmt(metrics.totals.files)} scoped files</div></div>
<div class="card metric"><div class="num">${fmt(metrics.totals.productionCode)}</div><div class="label">production LOC</div><div class="hint">${fmt(metrics.totals.testCode)} test/story LOC</div></div>
<div class="card metric"><div class="num">${fmt(metrics.duplicateGroups.length)}</div><div class="label">exact duplicate groups</div><div class="hint">intentional mirrors are allowlisted</div></div>
<div class="card metric"><div class="num">${fmt(metrics.complexFunctions.length)}</div><div class="label">complex functions</div><div class="hint">complexity &gt; ${BUDGETS.maxFunctionComplexity}</div></div>
<div class="card metric"><div class="num">${fmt(zeroFanInCandidates.length)}</div><div class="label">zero-fan-in candidates</div><div class="hint">excluding framework and package entrypoints</div></div>
</div>
</section>

<section>
<h2>Budgets</h2>
<div class="card">
${table(['Budget', 'Threshold', 'Enforcement'], [
  ['Exact duplicate production files', '0 groups', 'Except explicit intentional mirrors.'],
  ['Production file LOC', `No new file over ${BUDGETS.maxProductionFileLoc}`, 'Existing files are baseline debt; new files fail check.'],
  ['Function/component complexity', `No new item over ${BUDGETS.maxFunctionComplexity}`, 'Existing functions are baseline debt; new over-budget items fail check.'],
  ['Route handler LOC', `No new route over ${BUDGETS.maxRouteHandlerLoc}`, 'Existing protocol-heavy routes are baseline debt; new routes fail check.'],
  ...Object.entries(BUDGETS.monolithFileLocBudgets || {}).map(([file, maxLoc]) => [
    `Monolith LOC (${path.basename(file)})`,
    `Must stay at or below ${maxLoc}`,
    file,
  ]),
], (row) => `<tr><td>${htmlEscape(row[0])}</td><td>${htmlEscape(row[1])}</td><td>${htmlEscape(row[2])}</td></tr>`)}
</div>
</section>

<section>
<h2>Codebase Shape</h2>
<div class="card">
${table(['Layer', 'Files', 'Production LOC', 'Test LOC', 'Total LOC'], layers, ([layer, data]) => `<tr><td class="path">${htmlEscape(layer)}</td><td class="num">${fmt(data.files)}</td><td class="num">${fmt(data.productionCode)}</td><td class="num">${fmt(data.testCode)}</td><td class="num">${fmt(data.code)}</td></tr>`)}
</div>
</section>

<section>
<h2>Hotspots</h2>
<div class="two">
<div class="card"><h3>Largest Production Files</h3>${table(['File', 'Layer', 'LOC', 'Complexity'], largestFiles, (file) => `<tr><td class="path">${htmlEscape(file.file)}</td><td>${htmlEscape(file.layer)}</td><td class="num">${fmt(file.loc.code)}</td><td class="num">${fmt(file.complexity)}</td></tr>`)}</div>
<div class="card"><h3>Highest File Complexity</h3>${table(['File', 'Layer', 'LOC', 'Complexity'], highestComplexityFiles, (file) => `<tr><td class="path">${htmlEscape(file.file)}</td><td>${htmlEscape(file.layer)}</td><td class="num">${fmt(file.loc.code)}</td><td class="num">${fmt(file.complexity)}</td></tr>`)}</div>
</div>
<div class="card" style="margin-top:16px"><h3>Highest Function Complexity</h3>${table(['Function', 'File', 'Line', 'LOC', 'Complexity'], highestComplexityFunctions, (fn) => `<tr><td class="path">${htmlEscape(fn.name)}</td><td class="path">${htmlEscape(fn.file)}</td><td class="num">${fmt(fn.line)}</td><td class="num">${fmt(fn.loc)}</td><td class="num">${fmt(fn.complexity)}</td></tr>`)}</div>
</section>

<section>
<h2>Exact Duplicate Production Files</h2>
<div class="card">
${metrics.duplicateGroups.length ? table(['Group', 'Files'], metrics.duplicateGroups, (group, index) => `<tr><td class="num">${fmt(index + 1)}</td><td>${group.map((file) => `<div class="path">${htmlEscape(file)}</div>`).join('')}</td></tr>`) : '<p class="note">No exact duplicate production files found.</p>'}
</div>
</section>

<section>
<h2>Zero-Fan-In Audit</h2>
<div class="card">
${zeroFanInCandidates.length ? table(['File', 'Layer', 'LOC', 'Class', 'Reason'], zeroFanInCandidates, (file) => `<tr><td class="path">${htmlEscape(file.file)}</td><td>${htmlEscape(file.layer)}</td><td class="num">${fmt(file.loc)}</td><td>${htmlEscape(file.classification)}</td><td>${htmlEscape(file.reason)}</td></tr>`) : '<p class="note">No non-entrypoint zero-fan-in production candidates remain. Framework entrypoints, package public barrels, and configured tooling surfaces are classified as keep.</p>'}
</div>
</section>

<section>
<h2>Baseline Debt</h2>
<div class="two">
<div class="card"><h3>Files Over ${BUDGETS.maxProductionFileLoc} LOC</h3>${table(['File'], metrics.largeProductionFiles.map((file) => [file]), (row) => `<tr><td class="path">${htmlEscape(row[0])}</td></tr>`)}</div>
<div class="card"><h3>Route Handlers Over ${BUDGETS.maxRouteHandlerLoc} LOC</h3>${table(['File'], metrics.routeHandlersOverBudget.map((file) => [file]), (row) => `<tr><td class="path">${htmlEscape(row[0])}</td></tr>`)}</div>
</div>
</section>
</div>
</body>
</html>`
}

const metrics = collectMetrics()
const baseline = shouldUpdateBaseline ? buildBaseline(metrics) : loadBaseline()
if (shouldUpdateBaseline) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
}

const checkErrors = shouldCheck ? compareAgainstBaseline(metrics, baseline) : []

if (!shouldSkipHtml) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, generateHtml(metrics, checkErrors))
}

if (shouldPrintJson) {
  console.log(JSON.stringify({ metrics, checkErrors }, null, 2))
} else {
  console.log(`Web complexity report: ${path.relative(ROOT, REPORT_PATH)}`)
  console.log(`Web complexity baseline: ${path.relative(ROOT, BASELINE_PATH)}`)
  console.log(`Production LOC: ${fmt(metrics.totals.productionCode)}`)
  console.log(`Exact duplicate groups: ${fmt(metrics.duplicateGroups.length)}`)
  console.log(`Complex functions over ${BUDGETS.maxFunctionComplexity}: ${fmt(metrics.complexFunctions.length)}`)
  console.log(`Zero-fan-in review candidates: ${fmt(metrics.zeroFanInFiles.filter((file) => file.classification !== 'keep').length)}`)
}

if (shouldCheck && checkErrors.length > 0) {
  for (const error of checkErrors) console.error(`- ${error}`)
  process.exit(1)
}
