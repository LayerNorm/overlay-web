import { generateKeyPairSync } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type DeviceKeyPair = { publicKey: string; privateKey: string }

export async function loadOrCreateDeviceKeyPair(stateDirectory: string): Promise<DeviceKeyPair> {
  const keyDirectory = join(stateDirectory, 'keys')
  const publicPath = join(keyDirectory, 'device-public.pem')
  const privatePath = join(keyDirectory, 'device-private.pem')
  try {
    return { publicKey: await readFile(publicPath, 'utf8'), privateKey: await readFile(privatePath, 'utf8') }
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  await mkdir(keyDirectory, { recursive: true, mode: 0o700 })
  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  await writeFile(privatePath, pair.privateKey, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await writeFile(publicPath, pair.publicKey, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await chmod(keyDirectory, 0o700)
  return pair
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
