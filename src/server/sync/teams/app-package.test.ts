import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { teamsAppId, teamsAppManifest, teamsAppPackage } from './app-package'

function unzip(zip: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  let offset = 0
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const start = offset + 30 + nameLength
    files.set(name, inflateRawSync(zip.subarray(start, start + size)))
    offset = start + size
  }
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50)
  return files
}

test('the app id is a stable UUID per Entra app', () => {
  assert.equal(teamsAppId('client-a'), teamsAppId('client-a'))
  assert.notEqual(teamsAppId('client-a'), teamsAppId('client-b'))
  assert.match(teamsAppId('client-a'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('the manifest requests channel-message RSC and installs in teams', () => {
  const manifest = teamsAppManifest({ clientId: 'client-a', baseUrl: 'https://getoverlay.io/' })
  assert.equal(manifest.webApplicationInfo.id, 'client-a')
  assert.deepEqual(manifest.authorization.permissions.resourceSpecific, [
    { name: 'ChannelMessage.Read.Group', type: 'Application' },
    { name: 'ChannelSettings.Read.Group', type: 'Application' },
  ])
  assert.deepEqual(manifest.bots[0]?.scopes, ['team'])
  assert.equal(manifest.bots[0]?.isNotificationOnly, true)
  assert.deepEqual(manifest.validDomains, ['getoverlay.io'])
})

test('the package zips the manifest and both icons at Teams sizes', () => {
  const files = unzip(teamsAppPackage({ clientId: 'client-a', baseUrl: 'https://getoverlay.io' }))
  assert.deepEqual([...files.keys()], ['manifest.json', 'color.png', 'outline.png'])
  assert.equal(JSON.parse(files.get('manifest.json')!.toString('utf8')).id, teamsAppId('client-a'))
  const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)]
  assert.deepEqual(size(files.get('color.png')!), [192, 192])
  assert.deepEqual(size(files.get('outline.png')!), [32, 32])
})
