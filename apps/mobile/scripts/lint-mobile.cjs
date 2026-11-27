/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const baseline = require('./lint-baseline.json')
let output
try {
  output = execFileSync(
    path.join(root, '../../node_modules/.bin/eslint'),
    [
      'app',
      'components',
      'contexts',
      'hooks',
      'lib',
      'services',
      'scripts',
      'app.config.js',
      // The root config ignores apps/** for the web lint; mobile lints its own folders with the same rules.
      '--no-ignore',
      '--format',
      'json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
} catch (error) {
  if (!error.stdout) throw error
  output = error.stdout
}
let errors = 0,
  known = 0,
  warnings = 0
for (const file of JSON.parse(output)) {
  const name = path.relative(root, file.filePath)
  const entry = baseline.find((row) => row.path === name)
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file.filePath)).digest('hex')
  const remaining = entry && entry.sha256 === hash ? { ...entry.rules } : {}
  for (const diagnostic of file.messages) {
    if (diagnostic.severity !== 2) {
      warnings++
      continue
    }
    if (remaining[diagnostic.ruleId] > 0) {
      remaining[diagnostic.ruleId]--
      known++
      continue
    }
    errors++
    console.error(
      `${name}:${diagnostic.line}:${diagnostic.column} ${diagnostic.ruleId}: ${diagnostic.message}`,
    )
  }
}
console.log(
  `ESLint: ${errors} new errors; ${known} unchanged legacy errors (file-hash baseline); ${warnings} warnings`,
)
process.exitCode = errors ? 1 : 0
