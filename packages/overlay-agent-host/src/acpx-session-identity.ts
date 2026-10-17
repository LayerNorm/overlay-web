import {resolve} from 'node:path'
import type {AcpRuntime, AcpRuntimeHandle} from 'acpx/runtime'
import {z} from 'zod'

const id = z.string().min(1).max(2000)
const identitySchema = z.object({version: z.literal(1), sessionKey: id, agent: id,
  workingDirectory: z.string().min(1).max(4096), backendSessionId: id}).strict()
type Identity = z.infer<typeof identitySchema>

function identityFromHandle(handle: AcpRuntimeHandle, agent: string): Identity {
  const result = identitySchema.safeParse({version: 1, sessionKey: handle.sessionKey, agent,
    workingDirectory: handle.cwd, backendSessionId: handle.backendSessionId})
  if (!result.success) throw Error('ACP runtime did not provide a durable session identity')
  return result.data
}

type SessionIdentityInput = {
  runtime: Pick<AcpRuntime, 'findSession' | 'ensureSession' | 'close' | 'shutdown'>
  sessionKey: string; agent: string; workingDirectory: string; restoring: boolean
  checkpoint?: unknown
  persist(identity: Identity): Promise<void>
}

async function resolveRequestedIdentity(input: SessionIdentityInput) {
  const parsed = input.checkpoint === undefined ? undefined : identitySchema.safeParse(input.checkpoint)
  if (parsed && !parsed.success) throw Error('ACP session identity checkpoint is invalid')
  const checkpoint = parsed?.data
  const cwd = resolve(input.workingDirectory)
  if (checkpoint && (checkpoint.sessionKey !== input.sessionKey || checkpoint.agent !== input.agent
    || checkpoint.workingDirectory !== cwd)) throw Error('ACP session identity does not match the requested session')
  const existing = input.restoring || checkpoint
    ? await input.runtime.findSession?.({sessionKey: input.sessionKey, agent: input.agent}) : undefined
  const expected = checkpoint ?? (existing ? identityFromHandle(existing, input.agent) : undefined)
  if (input.restoring && !expected) throw Error('ACP session identity is unavailable; a new conversation cannot restore this execution')
  if (existing && expected && (existing.backendSessionId !== expected.backendSessionId || existing.cwd !== cwd))
    throw Error('ACP session record conflicts with its saved identity')
  return {cwd, expected}
}

/** Pin the ACP conversation before a first prompt; loading must never fall back to session/new. */
export async function ensureAcpxSessionIdentity(input: SessionIdentityInput): Promise<AcpRuntimeHandle> {
  let handle: AcpRuntimeHandle | undefined
  try {
    const {cwd, expected} = await resolveRequestedIdentity(input)
    handle = await input.runtime.ensureSession({sessionKey: input.sessionKey, agent: input.agent,
      mode: 'persistent', cwd, ...(expected ? {resumeSessionId: expected.backendSessionId} : {})})
    const actual = identityFromHandle(handle, input.agent)
    if (actual.sessionKey !== input.sessionKey || actual.workingDirectory !== cwd
      || (expected && actual.backendSessionId !== expected.backendSessionId))
      throw Error('ACP runtime replaced the requested conversation')
    await input.persist(actual)
    return handle
  } catch (error) {
    const cleanupErrors: unknown[] = []
    if (handle) await input.runtime.close({handle, reason: 'session identity initialization failed'}).catch(value => {cleanupErrors.push(value)})
    await input.runtime.shutdown?.().catch(value => {cleanupErrors.push(value)})
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'ACP session initialization cleanup was not confirmed')
    throw error
  }
}
