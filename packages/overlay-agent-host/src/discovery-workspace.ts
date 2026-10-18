import {mkdtemp, realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {isAbsolute, join, relative, sep} from 'node:path'

/** Discovery must never create upload candidates inside the agent's working drive. */
export async function createDiscoveryWorkspace(input: {workingDirectory: string; temporaryDirectory?: string}) {
  try {
    const [workspace, temporary] = await Promise.all([
      realpath(input.workingDirectory), realpath(input.temporaryDirectory ?? tmpdir()),
    ])
    const tail = relative(workspace, temporary)
    if (tail === '' || (!isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`))) return undefined
    return await mkdtemp(join(temporary, 'overlay-discovery-'))
  } catch {
    // Keep the default catalog when a separate private scratch directory is unavailable.
    return undefined
  }
}
