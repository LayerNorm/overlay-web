/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
fs.mkdirSync(dist, { recursive: true })

const lockText = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')
const lock = JSON.parse(lockText)
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lockDigest = createHash('sha256').update(lockText).digest('hex')
const serial = [
  lockDigest.slice(0, 8),
  lockDigest.slice(8, 12),
  `4${lockDigest.slice(13, 16)}`,
  `8${lockDigest.slice(17, 20)}`,
  lockDigest.slice(20, 32)
].join('-')

function packageNameFromPath(packagePath) {
  const marker = 'node_modules/'
  const index = packagePath.lastIndexOf(marker)
  return index >= 0 ? packagePath.slice(index + marker.length) : packagePath
}

function packageUrl(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name)
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`
}

const components = Object.entries(lock.packages ?? {})
  .filter(([packagePath, entry]) => packagePath && entry?.version)
  .map(([packagePath, entry]) => {
    const name = entry.name || packageNameFromPath(packagePath)
    const component = {
      type: 'library',
      'bom-ref': `npm:${packagePath}`,
      name,
      version: entry.version,
      purl: packageUrl(name, entry.version),
      properties: [
        { name: 'overlay:lockfile-path', value: packagePath },
        { name: 'overlay:development-only', value: String(entry.dev === true) }
      ]
    }
    if (typeof entry.resolved === 'string' && /^https:\/\//.test(entry.resolved)) {
      component.externalReferences = [{ type: 'distribution', url: entry.resolved }]
    }
    if (typeof entry.integrity === 'string' && entry.integrity.startsWith('sha512-')) {
      component.hashes = [
        {
          alg: 'SHA-512',
          content: Buffer.from(entry.integrity.slice('sha512-'.length), 'base64').toString('hex')
        }
      ]
    }
    return component
  })
  .sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']))

const sbom = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${serial}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: {
      components: [
        {
          type: 'application',
          name: 'overlay-lockfile-sbom-generator',
          version: '1'
        }
      ]
    },
    component: {
      type: 'application',
      'bom-ref': `pkg:npm/${packageJson.name}@${packageJson.version}`,
      name: packageJson.name,
      version: packageJson.version,
      purl: packageUrl(packageJson.name, packageJson.version)
    },
    properties: [
      { name: 'overlay:source', value: 'package-lock.json' },
      { name: 'overlay:lockfile-sha256', value: lockDigest }
    ]
  },
  components
})
fs.writeFileSync(path.join(dist, 'sbom.cdx.json'), `${sbom}\n`, { mode: 0o644 })
console.log(`Generated dist/sbom.cdx.json with ${components.length} components`)
