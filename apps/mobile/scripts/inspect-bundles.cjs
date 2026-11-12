/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const credentialPatterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['stripe-secret-key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['api-secret-key', /\b(?:sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}/i],
]
const syntheticFixturePatterns = [
  ['shared-markdown-route', /(?:^|\/)app\/dev\/shared-markdown\.tsx(?:$|[?#])/],
  ['shared-transcript-proof-component', /(?:^|\/)components\/chat\/SharedTranscriptProofMode\.tsx(?:$|[?#])/],
  ['shared-transcript-workspace-marker', /\bshared-transcript-proof-workspace\b/],
]

function inspectExport(root) {
  const maps = []
  const bundles = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (file.endsWith('.map')) maps.push(file)
      else if (file.endsWith('.js')) bundles.push(file)
    }
  }
  walk(root)
  if (!maps.length) throw new Error('No exported source maps found: ' + root)
  const foundCredentials = new Set()
  const foundFixtures = new Set()
  let bundleCount = 0
  function inspectCredentialText(text) {
    for (const [name, pattern] of credentialPatterns) if (pattern.test(text)) foundCredentials.add(name)
  }
  function inspectFixtureText(text) {
    for (const [name, pattern] of syntheticFixturePatterns) if (pattern.test(text)) foundFixtures.add(name)
  }
  for (const file of maps) {
    const map = JSON.parse(fs.readFileSync(file, 'utf8'))
    const leaks = []
    map.sources.forEach((originalSource, index) => {
      const source = originalSource.replaceAll('\\', '/')
      inspectFixtureText(source)
      if (source.includes('node_modules')) return
      if (
        /(^|\/)convex\//.test(source) ||
        source.includes('/@/') ||
        source.startsWith('@/') ||
        /\/scripts\/.*(?:Fixture|preview)/i.test(source)
      )
        leaks.push(source)
      const content = map.sourcesContent?.[index]
      if (content) {
        inspectCredentialText(content)
        inspectFixtureText(content)
        const code = ts.transpileModule(content, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ESNext,
            jsx: ts.JsxEmit.Preserve,
          },
          fileName: source,
        }).outputText
        if (/\b(?:from|import)\s*['"]@\//.test(code) || /require\(['"]@\//.test(code))
          leaks.push(source)
      }
    })
    if (leaks.length) throw new Error('Bundle portability leaks: ' + [...new Set(leaks)].join(', '))
  }
  for (const file of bundles) {
    const bundle = fs.readFileSync(file, 'utf8')
    inspectCredentialText(bundle)
    inspectFixtureText(bundle)
    bundleCount += 1
  }
  if (foundFixtures.size) {
    throw new Error(`${root}: synthetic shared Markdown fixture patterns found (${[...foundFixtures].join(', ')})`)
  }
  if (foundCredentials.size) {
    throw new Error(`${root}: possible credential patterns found (${[...foundCredentials].join(', ')}); values were not printed`)
  }
  for (const file of maps) {
    const map = JSON.parse(fs.readFileSync(file, 'utf8'))
    console.log(`${root}: ${map.sources.length} modules; no backend, alias, runtime @/ or fixture leaks`)
  }
  console.log(`${root}: no recognized credentials in ${bundleCount} JavaScript bundles and ${maps.length} source maps; values were not printed`)
}

if (require.main === module) {
  for (const root of process.argv.slice(2)) inspectExport(root)
}

module.exports = { inspectExport }
