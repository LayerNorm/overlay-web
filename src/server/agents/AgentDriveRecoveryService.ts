import 'server-only'
import {driveRecoveryRequestSchema, driveRecoveryResultSchema, type DriveRecoveryRequest} from '@layernorm/overlay-agent-bridge-protocol'
import type {AgentDriveTokenClaims} from './agent-drive-token'

/** Current execution credentials authorize receipt lookup, never replay of an older execution's write. */
export class AgentDriveRecoveryService {
  constructor(private readonly dependencies: {
    verifyToken(token: string | null): AgentDriveTokenClaims | null
    read(claims: AgentDriveTokenClaims, request: DriveRecoveryRequest): Promise<unknown>
  }) {}

  async recover(token: string | null, body: DriveRecoveryRequest) {
    const request = driveRecoveryRequestSchema.parse(body)
    const claims = this.dependencies.verifyToken(token)
    if (!claims) throw Error('DRIVE_UNAUTHORIZED')
    const result = driveRecoveryResultSchema.parse(await this.dependencies.read(claims, request))
    if (result.requestId !== request.requestId || result.previousExecution.attemptId !== request.previousExecution.attemptId
      || result.previousExecution.generation !== request.previousExecution.generation
      || (result.resolution.state === 'content_committed' && request.kind !== 'content')
      || (result.resolution.state === 'metadata_committed' && request.kind !== 'metadata')) throw Error('DRIVE_RECOVERY_UNAVAILABLE')
    return result
  }
}
