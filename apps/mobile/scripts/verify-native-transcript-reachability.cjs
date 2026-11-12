/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const requiredModules = [
  ['NativeSharedTranscript.dom.tsx', (source) => source.includes('NativeSharedTranscript.dom')],
  ['ChatTranscript.tsx', (source) => /(?:^|\/)ChatTranscript\.tsx(?:$|[?#])/.test(source)],
  ['ChatExchange.tsx', (source) => /(?:^|\/)ChatExchange\.tsx(?:$|[?#])/.test(source)],
]

for (const root of process.argv.slice(2)) {
  const maps = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (file.endsWith('.map')) maps.push(file)
    }
  }
  walk(root)
  if (!maps.length) throw new Error(`${root}: no exported JavaScript source maps found`)

  const found = new Set()
  for (const file of maps) {
    const map = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const originalSource of map.sources ?? []) {
      const source = originalSource.replaceAll('\\', '/')
      for (const [name, matches] of requiredModules) if (matches(source)) found.add(name)
    }
  }

  const missing = requiredModules.map(([name]) => name).filter((name) => !found.has(name))
  if (missing.length) throw new Error(`${root}: transcript modules missing from export source maps: ${missing.join(', ')}`)
  const platform = path.basename(root)
  console.log(`${platform}: source maps include ${requiredModules.map(([name]) => name).join(', ')} (${maps.length} maps checked)`)
}
