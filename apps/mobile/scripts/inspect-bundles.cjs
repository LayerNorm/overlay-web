/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const root of process.argv.slice(2)) {
  const maps = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (file.endsWith('.js.map')) maps.push(file)
    }
  }
  walk(root)
  if (!maps.length) throw new Error('No exported source maps found: ' + root)
  for (const file of maps) {
    const map = JSON.parse(fs.readFileSync(file, 'utf8'))
    const leaks = []
    map.sources.forEach((source, index) => {
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
    console.log(
      `${root}: ${map.sources.length} modules; no backend, alias, runtime @/ or fixture leaks`,
    )
  }
}
