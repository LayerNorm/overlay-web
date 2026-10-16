import 'server-only'
import { z } from 'zod'
import { driveCredentialsRequestSchema } from '@layernorm/overlay-agent-bridge-protocol'
import { agentDriveTokenInputSchema, createAgentDriveTokens } from './agent-drive-token'

export const driveCredentialRequestSchema = driveCredentialsRequestSchema.omit({ protocolVersion: true })
type Request = z.infer<typeof driveCredentialRequestSchema>
const authoritySchema = z.object({ claims: agentDriveTokenInputSchema.extend({ expiresAt: z.number().int().positive() }),
  hardDeadlineAt: z.number().int().positive() }).strict()

/** Every issuance/renewal rereads persisted authority. The host never selects an actor, binding or drive scope. */
export class AgentDriveCredentialService {
  private readonly tokens: ReturnType<typeof createAgentDriveTokens>
  constructor(private readonly dependencies: {
    enabled(): boolean
    secret: string
    lookup(input: Request & { workspaceId: string; environmentId: string }): Promise<unknown>
    now?: () => number
  }) { this.tokens = createAgentDriveTokens(dependencies) }

  async issue(host: { workspaceId: string; environmentId: string }, input: Request) {
    if (!this.dependencies.enabled()) throw Error('DRIVE_DISABLED')
    const request = driveCredentialRequestSchema.parse(input)
    const { claims, hardDeadlineAt } = authoritySchema.parse(await this.dependencies.lookup({ ...request, ...host }))
    if (claims.scope.workspaceId !== host.workspaceId || claims.environmentId !== host.environmentId
      || claims.runId !== request.runId || claims.sessionId !== request.sessionId
      || claims.execution?.attemptId !== request.execution?.attemptId
      || claims.execution?.generation !== request.execution?.generation) throw Error('DRIVE_RUN_UNAVAILABLE')
    const token = this.tokens.mint(claims, Math.min(hardDeadlineAt, claims.expiresAt))
    const verified = this.tokens.verify(token)
    if (!verified) throw Error('DRIVE_RUN_EXPIRED')
    return { token, expiresAt: verified.expiresAt, scope: verified.scope }
  }
}
