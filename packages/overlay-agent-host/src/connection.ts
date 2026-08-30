import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { environmentCredentialResponseSchema, filesystemGrantSchema } from '@layernorm/agent-bridge-protocol'

const storedConnectionSchema = environmentCredentialResponseSchema.extend({
  serverUrl: z.string().url(),
  controlPlaneUrl: z.string().url(),
  filesystemGrant: filesystemGrantSchema,
}).strict()
export type StoredAgentConnection = z.infer<typeof storedConnectionSchema>

export async function loadStoredConnection(stateDirectory: string): Promise<StoredAgentConnection | null> {
  try {
    return storedConnectionSchema.parse(JSON.parse(await readFile(connectionPath(stateDirectory), 'utf8')))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

export async function saveStoredConnection(stateDirectory: string, value: StoredAgentConnection): Promise<void> {
  const connection = storedConnectionSchema.parse(value)
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  const path = connectionPath(stateDirectory)
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

export function connectionPath(stateDirectory: string) { return join(stateDirectory, 'connection.json') }
