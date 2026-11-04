import {constants} from 'node:fs'
import {open, lstat, unlink} from 'node:fs/promises'
import {z} from 'zod/v3'

const accessSchema = z.object({origin: z.string().url(), secret: z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/)}).strict()
export type PreviewHostingAccess = z.infer<typeof accessSchema>

/** Consume the host's private bootstrap file before any provider can start. Never persist its contents. */
export async function consumePreviewHostingAccess(path: string, serverUrl: string): Promise<PreviewHostingAccess> {
  if (process.platform === 'win32') throw Error('Private Preview bootstrap requires POSIX file permissions')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o077) !== 0
      || (process.getuid && stat.uid !== process.getuid())) throw Error('Preview hosting access must be a private host-owned file')
    let access: PreviewHostingAccess
    try {access = accessSchema.parse(JSON.parse(await file.readFile('utf8')))} catch {throw Error('Invalid Preview hosting access file')}
    const origin = new URL(access.origin), server = new URL(serverUrl)
    if (origin.protocol !== 'https:' || origin.origin !== access.origin || origin.username || origin.password
      || server.protocol !== 'https:' || server.username || server.password || server.origin !== access.origin)
      throw Error('Preview hosting access does not match the configured HTTPS server')
    const current = await lstat(path)
    if (current.ino !== stat.ino || current.dev !== stat.dev) throw Error('Preview hosting access changed during startup')
    await unlink(path)
    return access
  } finally {await file.close()}
}

/** The hosting credential accompanies only this Preview's API requests; redirects cannot forward it. */
export function previewHostingFetch(access: PreviewHostingAccess, fetchImpl: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
    headers.delete('x-vercel-protection-bypass')
    if (url.origin === access.origin && url.pathname.startsWith('/api/') && !url.username && !url.password)
      headers.set('x-vercel-protection-bypass', access.secret)
    return fetchImpl(input, {...init, headers, redirect: 'error'})
  }
}
