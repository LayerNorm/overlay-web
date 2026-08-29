import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
type CheckRunner = () => Promise<{ stdout: string }>

export async function verifyHermesAcpReadiness(run: CheckRunner = async () => {
  const result = await execFileAsync('hermes', ['acp', '--check'], {
    timeout: 15_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  })
  return { stdout: result.stdout }
}) {
  try {
    const result = await run()
    if (!result.stdout.includes('Hermes ACP check OK')) throw new Error('unexpected readiness response')
  } catch (error) {
    throw new Error(
      'Hermes ACP is not ready. Install Hermes Agent 0.20.6 or newer, run `hermes acp --setup`, then verify it with `hermes acp --check` before reconnecting.',
      { cause: error },
    )
  }
}
