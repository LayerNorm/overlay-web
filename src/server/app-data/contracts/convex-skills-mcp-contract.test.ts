import 'server-only'

import test from 'node:test'
import { ConvexMcpServerRepository, ConvexSkillRepository } from '@/server/extensions'
import { ConvexProjectRepository } from '@/server/projects/ConvexProjectRepository'
import { runSkillsMcpContract } from './skills-mcp-contract'

const enabled = process.env.APP_DATA_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('real Convex skills and MCP provider contract', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set APP_DATA_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  await runSkillsMcpContract(t, {
    mcpServers: new ConvexMcpServerRepository(),
    projects: new ConvexProjectRepository(),
    provider: 'convex',
    skills: new ConvexSkillRepository(),
  })
})
