import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec = promisify(execFile)

/** A zombie has already exited and cannot execute; signal permission alone cannot distinguish it. */
export async function processGroupHasLiveMembers(groupId: number): Promise<boolean> {
  if (!Number.isSafeInteger(groupId) || groupId <= 1) throw Error('Invalid process group')
  // Both BSD and Linux ps support these columns. Never inspect command arguments or environment.
  const {stdout} = await exec('ps', ['-axo', 'pid=,pgid=,stat='], {timeout: 3000, maxBuffer: 2 * 1024 * 1024})
  const lines = stdout.trim().split('\n')
  let live = false
  for (const line of lines) {
    const row = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line)
    if (!row) throw Error('Could not verify process group state')
    if (Number(row[2]) === groupId && !row[3].startsWith('Z')) live = true
  }
  return live
}

export async function signalProcessGroup(groupId: number, signal: NodeJS.Signals): Promise<void> {
  if (!Number.isSafeInteger(groupId) || groupId <= 1) throw Error('Invalid process group')
  try {process.kill(-groupId, signal)}
  catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ESRCH') return
      // Darwin returns EPERM for zombie-only groups. A live member or failed OS readback still fails.
      if (error.code === 'EPERM' && !await processGroupHasLiveMembers(groupId)) return
    }
    throw error
  }
}
