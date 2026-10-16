import 'server-only'

import type { NextRequest } from 'next/server'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { connectedAgentDriveEnabled, createAgentDriveService } from './create-agent-drive-service'
import type { DriveHttpDependencies } from './agent-drive-http'
import { createAgentDriveContentService } from './create-agent-drive-content-service'

export const agentDriveHttpDependencies: DriveHttpDependencies = {
  enabled: connectedAgentDriveEnabled, service: createAgentDriveService,
  writes: createAgentDriveContentService,
  limit: (request, token) => enforceRateLimits(request as NextRequest, [
    { bucket: 'agent-drive:ip', key: getClientIp(request), limit: 1200, windowMs: 60000 },
    { bucket: 'agent-drive:credential', key: hashOperationalIdentifier('agent-drive:v1', token), limit: 600, windowMs: 60000 },
  ]),
}
