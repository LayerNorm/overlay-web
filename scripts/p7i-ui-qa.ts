import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = required('P7I_UI_QA_URL').replace(/\/$/, '')
const storageState = path.resolve(required('P7I_UI_QA_STORAGE_STATE'))
await access(storageState)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ storageState })
const page = await context.newPage()
const convexTraffic = new Set<string>()
const pageErrors: string[] = []
context.on('request', (request) => { if (isConvex(request.url())) convexTraffic.add(request.url()) })
context.on('websocket', (socket) => { if (isConvex(socket.url())) convexTraffic.add(socket.url()) })
page.on('pageerror', (error) => pageErrors.push(error.message))

let skillId: string | undefined
let mcpServerId: string | undefined
try {
  const capabilities = await context.request.get(`${baseUrl}/api/v1/capabilities`)
  assert.equal(capabilities.ok(), true)
  const capabilityBody = await capabilities.json() as {
    capabilities: { mcpServers?: boolean; skills?: boolean }
    appDataCapabilities: { provider?: string; requiresConvexClient?: boolean }
  }
  assert.equal(capabilityBody.appDataCapabilities.provider, 'postgres')
  assert.equal(capabilityBody.appDataCapabilities.requiresConvexClient, false)
  assert.equal(capabilityBody.capabilities.skills, true)
  assert.equal(capabilityBody.capabilities.mcpServers, true)

  const suffix = Date.now()
  const skill = await context.request.post(`${baseUrl}/api/v1/skills`, {
    data: {
      description: 'P7i browser QA',
      instructions: 'Return concise answers.',
      name: `P7i QA skill ${suffix}`,
    },
  })
  assert.equal(skill.ok(), true)
  skillId = (await skill.json() as { id: string }).id

  const mcp = await context.request.post(`${baseUrl}/api/v1/mcps`, {
    data: {
      defaultToolPolicy: 'approval_required',
      enabled: false,
      name: `P7i QA MCP ${suffix}`,
      transport: 'streamable-http',
      url: 'https://mcp.example.test/api',
    },
  })
  assert.equal(mcp.ok(), true)
  mcpServerId = (await mcp.json() as { id: string }).id

  const mcpList = await context.request.get(`${baseUrl}/api/v1/mcps`)
  const servers = await mcpList.json() as Array<Record<string, unknown>>
  const created = servers.find((server) => server._id === mcpServerId)
  assert.equal(created?.defaultToolPolicy, 'approval_required')
  assert.equal('authConfig' in (created ?? {}), false)

  await page.goto(`${baseUrl}/app/tools?view=skills`, { waitUntil: 'domcontentloaded' })
  await page.getByText(`P7i QA skill ${suffix}`).waitFor()
  const secondTab = await context.newPage()
  await secondTab.goto(`${baseUrl}/app/tools?view=mcps`, { waitUntil: 'domcontentloaded' })
  await secondTab.getByText(`P7i QA MCP ${suffix}`).waitFor()
  await secondTab.close()

  assert.deepEqual([...convexTraffic], [], `Convex traffic detected: ${[...convexTraffic].join(', ')}`)
  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`)
  console.log(JSON.stringify({
    baseUrl,
    convexRequests: 0,
    mcpPolicy: 'approval_required',
    ok: true,
    secondTabConsistency: true,
    skillCrud: true,
  }, null, 2))
} finally {
  if (mcpServerId) {
    await context.request.delete(`${baseUrl}/api/v1/mcps?mcpServerId=${encodeURIComponent(mcpServerId)}`)
  }
  if (skillId) {
    await context.request.delete(`${baseUrl}/api/v1/skills?skillId=${encodeURIComponent(skillId)}`)
  }
  await context.close()
  await browser.close()
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function isConvex(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'convex.cloud' || hostname.endsWith('.convex.cloud') ||
      hostname === 'convex.site' || hostname.endsWith('.convex.site')
  } catch {
    return false
  }
}
