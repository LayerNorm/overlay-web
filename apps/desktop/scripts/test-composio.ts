/**
 * Composio Integration Test Script
 *
 * Tests Gmail and Google Calendar tools using the Composio SDK.
 * This script tests both the session-based approach (recommended) and direct tool execution.
 *
 * Prerequisites:
 * - COMPOSIO_API_KEY in .env or environment
 * - Gmail and Google Calendar already connected in Composio dashboard
 *
 * Run: pnpm tsx scripts/test-composio.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import axios from 'axios'

// Load environment variables
config({ path: resolve(process.cwd(), '.env') })
config({ path: resolve(process.cwd(), '.env.local') })

// Try to get API key from multiple sources:
// 1. Command line argument: npx tsx scripts/test-composio.ts YOUR_API_KEY
// 2. Environment variable: COMPOSIO_API_KEY
// 3. Show instructions on how to get it

function getApiKey(): string | null {
  // 1. Check command line argument
  const cliArg = process.argv[2]
  if (cliArg && !cliArg.startsWith('-')) {
    console.log('[Config] Using API key from command line argument')
    return cliArg
  }

  // 2. Check environment variable
  if (process.env.COMPOSIO_API_KEY) {
    console.log('[Config] Using API key from COMPOSIO_API_KEY env var')
    return process.env.COMPOSIO_API_KEY
  }

  return null
}

const COMPOSIO_API_KEY = getApiKey()
const COMPOSIO_BASE_URL = 'https://backend.composio.dev/api/v3'

// ── Logging Helpers ───────────────────────────────────────────────────────────

function log(section: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString()
  console.log(`\n[${timestamp}] [${section}] ${message}`)
  if (data !== undefined) {
    console.log(JSON.stringify(data, null, 2))
  }
}

function logError(section: string, message: string, error: unknown): void {
  const timestamp = new Date().toISOString()
  console.error(`\n[${timestamp}] [${section}] ❌ ${message}`)
  if (axios.isAxiosError(error)) {
    console.error('Status:', error.response?.status)
    console.error('Response:', JSON.stringify(error.response?.data, null, 2))
  } else if (error instanceof Error) {
    console.error('Error:', error.message)
    console.error('Stack:', error.stack)
  } else {
    console.error('Error:', error)
  }
}

function logSuccess(section: string, message: string): void {
  const timestamp = new Date().toISOString()
  console.log(`\n[${timestamp}] [${section}] ✅ ${message}`)
}

function logHeader(title: string): void {
  console.log('\n' + '═'.repeat(70))
  console.log(`  ${title}`)
  console.log('═'.repeat(70))
}

// ── API Helpers ───────────────────────────────────────────────────────────────

function getHeaders(): Record<string, string> {
  if (!COMPOSIO_API_KEY) {
    throw new Error('COMPOSIO_API_KEY not found in environment')
  }
  return {
    'x-api-key': COMPOSIO_API_KEY,
    'Content-Type': 'application/json'
  }
}

// ── Test 1: Check API Key and User ────────────────────────────────────────────

async function testApiKey(): Promise<string | null> {
  logHeader('TEST 1: Verify API Key & Get User Info')

  try {
    log('API', 'Testing API key validity by fetching connected accounts...')

    // Use connected_accounts endpoint to validate API key
    const response = await axios.get(`${COMPOSIO_BASE_URL}/connected_accounts`, {
      headers: getHeaders(),
      params: { limit: 1 }
    })

    log('API', 'API validation response:', {
      status: 'success',
      hasItems: !!response.data?.items
    })
    logSuccess('API', 'API key is valid!')

    return 'default-user'
  } catch (error) {
    logError('API', 'API key validation failed', error)
    return null
  }
}

// ── Test 2: List Connected Accounts ───────────────────────────────────────────

interface ConnectedAccount {
  id: string
  status: string
  toolkit?: { slug?: string; name?: string }
  created_at?: string
  entity_id?: string
  user_id?: string
}

async function testListConnectedAccounts(): Promise<ConnectedAccount[]> {
  logHeader('TEST 2: List Connected Accounts')

  try {
    log('Accounts', 'Fetching connected accounts...')

    const response = await axios.get(`${COMPOSIO_BASE_URL}/connected_accounts`, {
      headers: getHeaders(),
      params: { limit: 50 }
    })

    const accounts: ConnectedAccount[] = response.data?.items || []
    log('Accounts', `Found ${accounts.length} connected accounts:`)

    for (const account of accounts) {
      const status = account.status === 'ACTIVE' ? '✅' : '❌'
      console.log(
        `  ${status} ${account.toolkit?.slug || 'unknown'}: ${account.id} (${account.status})`
      )
    }

    const gmailAccount = accounts.find((a) => a.toolkit?.slug === 'gmail' && a.status === 'ACTIVE')
    const calendarAccount = accounts.find(
      (a) => a.toolkit?.slug === 'googlecalendar' && a.status === 'ACTIVE'
    )

    if (gmailAccount) {
      logSuccess('Accounts', `Gmail connected: ${gmailAccount.id}`)
    } else {
      log('Accounts', '⚠️ No active Gmail connection found')
    }

    if (calendarAccount) {
      logSuccess('Accounts', `Google Calendar connected: ${calendarAccount.id}`)
    } else {
      log('Accounts', '⚠️ No active Google Calendar connection found')
    }

    return accounts
  } catch (error) {
    logError('Accounts', 'Failed to list connected accounts', error)
    return []
  }
}

// ── Test 3: List Available Tools ──────────────────────────────────────────────

interface Tool {
  slug: string
  name: string
  description?: string
  toolkit?: { slug?: string }
}

async function testListTools(toolkit: string): Promise<Tool[]> {
  logHeader(`TEST 3: List Available Tools for ${toolkit}`)

  try {
    log('Tools', `Fetching tools for toolkit: ${toolkit}...`)

    const response = await axios.get(`${COMPOSIO_BASE_URL}/tools`, {
      headers: getHeaders(),
      params: {
        toolkit_slug: toolkit,
        toolkit_versions: 'latest',
        limit: 50
      }
    })

    const tools: Tool[] = response.data?.items || []
    log('Tools', `Found ${tools.length} tools for ${toolkit}:`)

    for (const tool of tools.slice(0, 15)) {
      console.log(`  - ${tool.slug}: ${tool.name}`)
    }

    if (tools.length > 15) {
      console.log(`  ... and ${tools.length - 15} more`)
    }

    logSuccess('Tools', `Listed ${tools.length} tools for ${toolkit}`)
    return tools
  } catch (error) {
    logError('Tools', `Failed to list tools for ${toolkit}`, error)
    return []
  }
}

// ── Test 4: Get Tool Schema ───────────────────────────────────────────────────

async function testGetToolSchema(toolSlug: string): Promise<unknown> {
  logHeader(`TEST 4: Get Tool Schema for ${toolSlug}`)

  try {
    log('Schema', `Fetching schema for tool: ${toolSlug}...`)

    const response = await axios.get(`${COMPOSIO_BASE_URL}/tools/${toolSlug}`, {
      headers: getHeaders(),
      params: {
        toolkit_versions: 'latest'
      }
    })

    const schema = response.data
    log('Schema', 'Tool schema:', {
      slug: schema?.slug,
      name: schema?.name,
      description: schema?.description?.substring(0, 200),
      inputParameters: schema?.inputParameters
    })

    logSuccess('Schema', `Retrieved schema for ${toolSlug}`)
    return schema
  } catch (error) {
    logError('Schema', `Failed to get schema for ${toolSlug}`, error)
    return null
  }
}

// ── Test 5: Execute Tool - Gmail List Emails ──────────────────────────────────

async function testGmailListEmails(connectedAccountId: string, userId: string): Promise<void> {
  logHeader('TEST 5: Execute GMAIL_LIST_EMAILS')

  try {
    const toolSlug = 'GMAIL_LIST_EMAILS'
    const params = {
      max_results: 5
    }

    log('Execute', `Executing tool: ${toolSlug}`)
    log('Execute', `Connected Account ID: ${connectedAccountId}`)
    log('Execute', `Entity/User ID: ${userId}`)
    log('Execute', 'Parameters:', params)

    // v3 API: POST /tools/execute/:action with entity_id
    log('Execute', 'Trying API format: POST /tools/execute/:action with entity_id')

    const requestBody = {
      connected_account_id: connectedAccountId,
      entity_id: userId,
      arguments: params
    }
    log('Execute', 'Request body:', requestBody)

    const response = await axios.post(
      `${COMPOSIO_BASE_URL}/tools/execute/${toolSlug}`,
      requestBody,
      { headers: getHeaders() }
    )

    log('Execute', 'Response:', response.data)
    logSuccess('Execute', `${toolSlug} executed successfully!`)
  } catch (error) {
    logError('Execute', 'GMAIL_LIST_EMAILS failed', error)

    // Try alternative format
    try {
      log('Execute', 'Trying alternative API format: POST /tools/execute with tool_slug in body')

      const response = await axios.post(
        `${COMPOSIO_BASE_URL}/tools/execute`,
        {
          tool_slug: 'GMAIL_LIST_EMAILS',
          connected_account_id: connectedAccountId,
          arguments: { max_results: 5 }
        },
        { headers: getHeaders() }
      )

      log('Execute', 'Alternative response:', response.data)
      logSuccess('Execute', 'Alternative format worked!')
    } catch (altError) {
      logError('Execute', 'Alternative format also failed', altError)
    }
  }
}

// ── Test 6: Execute Tool - Gmail Search ───────────────────────────────────────

async function testGmailSearch(connectedAccountId: string, userId: string): Promise<void> {
  logHeader('TEST 6: Execute GMAIL_SEARCH_EMAILS')

  try {
    const toolSlug = 'GMAIL_SEARCH_EMAILS'
    const params = {
      query: 'is:unread',
      max_results: 3
    }

    log('Execute', `Executing tool: ${toolSlug}`)
    log('Execute', `Connected Account ID: ${connectedAccountId}`)
    log('Execute', `Entity/User ID: ${userId}`)
    log('Execute', 'Parameters:', params)

    const response = await axios.post(
      `${COMPOSIO_BASE_URL}/tools/execute/${toolSlug}`,
      {
        connected_account_id: connectedAccountId,
        entity_id: userId,
        arguments: params
      },
      { headers: getHeaders() }
    )

    log('Execute', 'Response:', response.data)
    logSuccess('Execute', `${toolSlug} executed successfully!`)
  } catch (error) {
    logError('Execute', 'GMAIL_SEARCH_EMAILS failed', error)
  }
}

// ── Test 7: Execute Tool - Calendar List Events ───────────────────────────────

async function testCalendarListEvents(connectedAccountId: string, userId: string): Promise<void> {
  logHeader('TEST 7: Execute GOOGLECALENDAR_FIND_EVENT')

  try {
    const toolSlug = 'GOOGLECALENDAR_FIND_EVENT'
    const now = new Date()
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const params = {
      time_min: now.toISOString(),
      time_max: nextWeek.toISOString(),
      max_results: 10
    }

    log('Execute', `Executing tool: ${toolSlug}`)
    log('Execute', `Connected Account ID: ${connectedAccountId}`)
    log('Execute', `Entity/User ID: ${userId}`)
    log('Execute', 'Parameters:', params)

    const response = await axios.post(
      `${COMPOSIO_BASE_URL}/tools/execute/${toolSlug}`,
      {
        connected_account_id: connectedAccountId,
        entity_id: userId,
        arguments: params
      },
      { headers: getHeaders() }
    )

    log('Execute', 'Response:', response.data)
    logSuccess('Execute', `${toolSlug} executed successfully!`)
  } catch (error) {
    logError('Execute', 'GOOGLECALENDAR_FIND_EVENT failed', error)
  }
}

// ── Test 8: Execute Tool - Calendar List Calendars ────────────────────────────

async function testCalendarListCalendars(
  connectedAccountId: string,
  userId: string
): Promise<void> {
  logHeader('TEST 8: Execute GOOGLECALENDAR_LIST_CALENDARS')

  try {
    const toolSlug = 'GOOGLECALENDAR_LIST_CALENDARS'

    log('Execute', `Executing tool: ${toolSlug}`)
    log('Execute', `Connected Account ID: ${connectedAccountId}`)
    log('Execute', `Entity/User ID: ${userId}`)

    const response = await axios.post(
      `${COMPOSIO_BASE_URL}/tools/execute/${toolSlug}`,
      {
        connected_account_id: connectedAccountId,
        entity_id: userId,
        arguments: {}
      },
      { headers: getHeaders() }
    )

    log('Execute', 'Response:', response.data)
    logSuccess('Execute', `${toolSlug} executed successfully!`)
  } catch (error) {
    logError('Execute', 'GOOGLECALENDAR_LIST_CALENDARS failed', error)
  }
}

// ── Test 9: Test Session-Based Approach with SDK ──────────────────────────────

async function testSessionBasedApproach(): Promise<void> {
  logHeader('TEST 9: Session-Based Approach with Composio SDK')

  try {
    log('SDK', 'Importing Composio SDK...')

    // Dynamic import to handle potential module issues
    const { Composio } = await import('@composio/core')
    const { VercelProvider } = await import('@composio/vercel')

    log('SDK', 'Creating Composio instance with VercelProvider...')

    const composio = new Composio({
      apiKey: COMPOSIO_API_KEY,
      provider: new VercelProvider()
    })

    log('SDK', 'Composio instance created successfully')

    // Create a session for the user
    const userId = `overlay-test-${Date.now()}`
    log('SDK', `Creating session for user: ${userId}`)

    const session = await composio.create(userId)
    log('SDK', 'Session created:', {
      userId,
      sessionCreated: !!session
    })

    // Get tools from session
    log('SDK', 'Fetching tools from session...')
    const tools = await session.tools()
    log('SDK', `Got ${Object.keys(tools).length} tools from session`)

    // Log tool names
    const toolNames = Object.keys(tools).slice(0, 10)
    log('SDK', 'Sample tools:', toolNames)

    logSuccess('SDK', 'Session-based approach works!')
  } catch (error) {
    logError('SDK', 'Session-based approach failed', error)
    log(
      'SDK',
      'Note: Session-based approach requires proper SDK setup and may not work in all environments'
    )
  }
}

// ── Test 10: Test Direct SDK Tool Execution ───────────────────────────────────

async function testDirectSDKExecution(connectedAccountId: string): Promise<void> {
  logHeader('TEST 10: Direct SDK Tool Execution')

  try {
    log('SDK-Direct', 'Importing Composio SDK...')

    const { Composio } = await import('@composio/core')

    const composio = new Composio({
      apiKey: COMPOSIO_API_KEY,
      toolkitVersions: {
        gmail: 'latest',
        googlecalendar: 'latest'
      }
    })

    log('SDK-Direct', 'Executing GMAIL_LIST_EMAILS via SDK...')

    // Using tools.execute directly
    const result = await composio.tools.execute('GMAIL_LIST_EMAILS', {
      connectedAccountId,
      arguments: {
        max_results: 3
      }
    })

    log('SDK-Direct', 'SDK execution result:', result)
    logSuccess('SDK-Direct', 'Direct SDK execution works!')
  } catch (error) {
    logError('SDK-Direct', 'Direct SDK execution failed', error)
  }
}

// ── Main Test Runner ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n')
  console.log('╔══════════════════════════════════════════════════════════════════════╗')
  console.log('║           COMPOSIO INTEGRATION TEST SUITE                            ║')
  console.log('║           Testing Gmail & Google Calendar Tools                       ║')
  console.log('╚══════════════════════════════════════════════════════════════════════╝')

  // Check for API key
  if (!COMPOSIO_API_KEY) {
    console.error('\n❌ COMPOSIO_API_KEY not found')
    console.error('')
    console.error('   Usage: npx tsx scripts/test-composio.ts YOUR_API_KEY')
    console.error('')
    console.error('   Get your API key from: https://platform.composio.dev/settings')
    console.error('   Or set COMPOSIO_API_KEY environment variable')
    process.exit(1)
  }

  log('Main', `API Key found: ${COMPOSIO_API_KEY.substring(0, 8)}...`)

  // Run tests
  const results: { test: string; passed: boolean }[] = []

  // Test 1: API Key
  const userId = await testApiKey()
  results.push({ test: 'API Key Validation', passed: !!userId })

  if (!userId) {
    console.error('\n❌ Cannot proceed without valid API key')
    process.exit(1)
  }

  // Test 2: List Connected Accounts
  const accounts = await testListConnectedAccounts()
  results.push({ test: 'List Connected Accounts', passed: accounts.length > 0 })

  // Find Gmail and Calendar accounts
  const gmailAccount = accounts.find((a) => a.toolkit?.slug === 'gmail' && a.status === 'ACTIVE')
  const calendarAccount = accounts.find(
    (a) => a.toolkit?.slug === 'googlecalendar' && a.status === 'ACTIVE'
  )

  // Test 3: List Gmail Tools
  const gmailTools = await testListTools('gmail')
  results.push({ test: 'List Gmail Tools', passed: gmailTools.length > 0 })

  // Test 3b: List Calendar Tools
  const calendarTools = await testListTools('googlecalendar')
  results.push({ test: 'List Calendar Tools', passed: calendarTools.length > 0 })

  // Test 4: Get Tool Schema
  const schema = await testGetToolSchema('GMAIL_LIST_EMAILS')
  results.push({ test: 'Get Tool Schema', passed: !!schema })

  // Get the user_id from connected account (stored in entity_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getUserIdFromAccount = (account: any): string => {
    return account.entity_id || account.user_id || 'default'
  }

  // Test 5-8: Execute Tools (only if accounts are connected)
  if (gmailAccount) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gmailUserId = getUserIdFromAccount(gmailAccount as any)
    log('Main', `Gmail user/entity ID: ${gmailUserId}`)
    await testGmailListEmails(gmailAccount.id, gmailUserId)
    await testGmailSearch(gmailAccount.id, gmailUserId)
  } else {
    log('Main', '⚠️ Skipping Gmail tests - no active connection')
    results.push({ test: 'Gmail List Emails', passed: false })
    results.push({ test: 'Gmail Search', passed: false })
  }

  if (calendarAccount) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calendarUserId = getUserIdFromAccount(calendarAccount as any)
    log('Main', `Calendar user/entity ID: ${calendarUserId}`)
    await testCalendarListEvents(calendarAccount.id, calendarUserId)
    await testCalendarListCalendars(calendarAccount.id, calendarUserId)
  } else {
    log('Main', '⚠️ Skipping Calendar tests - no active connection')
    results.push({ test: 'Calendar List Events', passed: false })
    results.push({ test: 'Calendar List Calendars', passed: false })
  }

  // Test 9: Session-based approach
  await testSessionBasedApproach()

  // Test 10: Direct SDK execution
  if (gmailAccount) {
    await testDirectSDKExecution(gmailAccount.id)
  }

  // Summary
  logHeader('TEST SUMMARY')
  console.log('\n')
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌'
    console.log(`  ${icon} ${result.test}`)
  }

  const passed = results.filter((r) => r.passed).length
  const total = results.length
  console.log(`\n  Total: ${passed}/${total} tests passed`)

  if (passed < total) {
    console.log('\n⚠️ Some tests failed. Check the logs above for details.')
  } else {
    console.log('\n🎉 All tests passed!')
  }
}

// Run main
main().catch((error) => {
  console.error('\n❌ Test suite failed with error:', error)
  process.exit(1)
})
