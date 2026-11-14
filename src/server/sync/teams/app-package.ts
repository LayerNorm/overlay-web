import 'server-only'

import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { TEAMS_COLOR_ICON_PNG, TEAMS_OUTLINE_ICON_PNG } from './app-icons'

/** Resource-specific consent the team owner grants when adding Overlay to a team: read channel messages and channel names. */
export const TEAMS_RSC_PERMISSIONS = ['ChannelMessage.Read.Group', 'ChannelSettings.Read.Group']

/** A stable Teams app id derived from the Entra client id, so every download of the package is the same app. */
export function teamsAppId(clientId: string): string {
  const hex = createHash('sha256').update('overlay-teams-sync-app:' + clientId).digest('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16), ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20), hex.slice(20, 32)].join('-')
}

/**
 * The Teams app manifest. Installing it in a team grants the RSC permissions
 * above, so Overlay can read and subscribe to that team's channels with an
 * app-only token without tenant-wide ChannelMessage.Read.All. The
 * notification-only bot exists because Teams only installs apps into teams
 * that have a team-scoped capability; it never posts or receives chat.
 */
export function teamsAppManifest(args: { clientId: string; baseUrl: string }) {
  const base = args.baseUrl.replace(/\/$/, '')
  return {
    $schema: 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json',
    manifestVersion: '1.17',
    version: '1.0.0',
    id: teamsAppId(args.clientId),
    developer: {
      name: 'LayerNorm',
      websiteUrl: base,
      privacyUrl: base + '/privacy',
      termsOfUseUrl: base + '/terms',
    },
    name: { short: 'Overlay', full: 'Overlay channel sync' },
    description: {
      short: 'Keep Teams channels in sync with Overlay.',
      full: 'Overlay keeps the Teams channels your admins link in sync with Overlay channels in both directions. Add Overlay to a team, then link its channels in Overlay settings under Import & sync.',
    },
    icons: { color: 'color.png', outline: 'outline.png' },
    accentColor: '#1F1F1F',
    bots: [{ botId: args.clientId, scopes: ['team'], isNotificationOnly: true, supportsFiles: false }],
    permissions: ['identity'],
    validDomains: [new URL(base).host],
    webApplicationInfo: { id: args.clientId, resource: base + '/api/v1/sync/teams' },
    authorization: {
      permissions: {
        resourceSpecific: TEAMS_RSC_PERMISSIONS.map(name => ({ name, type: 'Application' })),
      },
    },
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Writes a deflated ZIP archive of flat files, the format Teams accepts for app packages. */
export function zipFiles(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const compressed = deflateRawSync(file.data)
    const crc = crc32(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0x00210000, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(0x00210000, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** The zipped Teams app package (manifest.json, color.png, outline.png) an admin uploads in the Teams admin center. */
export function teamsAppPackage(args: { clientId: string; baseUrl: string }): Buffer {
  return zipFiles([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(teamsAppManifest(args), null, 2)) },
    { name: 'color.png', data: Buffer.from(TEAMS_COLOR_ICON_PNG, 'base64') },
    { name: 'outline.png', data: Buffer.from(TEAMS_OUTLINE_ICON_PNG, 'base64') },
  ])
}
