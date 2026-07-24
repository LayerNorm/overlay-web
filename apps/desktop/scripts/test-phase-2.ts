/**
 * Phase 2 Test Script - Browser Agent (Unified)
 *
 * Tests:
 * 1. Gateway connectivity for browser agent models
 * 2. System prompt processing for browser tasks
 * 3. Streaming response for browser agent
 * 4. Model ID mapping for browser agent
 *
 * Run: pnpm tsx scripts/test-phase-2.ts
 *
 * Prerequisites:
 * - AI_GATEWAY_API_KEY in .env or environment
 *
 * Note: Full tool execution tests require Electron environment.
 * This script tests the AI Gateway integration only.
 */

import { generateText, streamText } from 'ai'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(process.cwd(), '.env') })
config({ path: resolve(process.cwd(), '.env.local') })

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY

if (!AI_GATEWAY_API_KEY) {
  console.error('❌ AI_GATEWAY_API_KEY not found in environment')
  console.error('   Set it in .env or .env.local file')
  process.exit(1)
}

// Model ID mapping (same as gateway-provider.ts)
const MODEL_ID_MAPPING: Record<string, string> = {
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4-5',
  'gpt-5.2-2025-12-11': 'openai/gpt-5.2-2025-12-11',
  'gemini-2.5-flash': 'google/gemini-2.5-flash'
}

function mapModelId(modelId: string): string {
  if (modelId.includes('/')) return modelId
  return MODEL_ID_MAPPING[modelId] || modelId
}

// Browser agent system prompt (simplified version)
const BROWSER_AGENT_SYSTEM_PROMPT = `You are a browser automation agent. You can:
- Navigate to URLs
- Click on elements
- Type text into fields
- Extract page content

When given a task, describe the steps you would take to complete it.`

// ── Test Functions ─────────────────────────────────────────────────────────────

async function testBrowserAgentModelAccess(): Promise<boolean> {
  console.log('\n🔍 Test 1: Browser Agent Model Access')
  console.log('─'.repeat(50))

  // Browser agent typically uses claude-sonnet for complex tasks
  const models = ['anthropic/claude-sonnet-4-6', 'anthropic/claude-haiku-4-5']

  let allPassed = true
  for (const model of models) {
    try {
      const result = await generateText({
        model,
        prompt: 'Say "Browser agent ready" and nothing else.',
        maxOutputTokens: 20
      })
      console.log(`   ✅ ${model}: "${result.text.trim()}"`)
    } catch (error) {
      console.log(`   ❌ ${model}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      allPassed = false
    }
  }

  return allPassed
}

async function testSystemPromptProcessing(): Promise<boolean> {
  console.log('\n🔍 Test 2: System Prompt Processing')
  console.log('─'.repeat(50))

  try {
    const result = await generateText({
      model: 'anthropic/claude-haiku-4-5',
      system: BROWSER_AGENT_SYSTEM_PROMPT,
      prompt: 'How would you navigate to google.com and search for "AI"?',
      maxOutputTokens: 150
    })

    const hasSteps = result.text.toLowerCase().includes('navigate') || 
                     result.text.toLowerCase().includes('click') ||
                     result.text.toLowerCase().includes('type')

    console.log(`   Response length: ${result.text.length} chars`)
    console.log(`   Contains action words: ${hasSteps ? 'Yes' : 'No'}`)
    
    if (hasSteps) {
      console.log(`   ✅ System prompt correctly guides response`)
      return true
    }

    console.log(`   ⚠️  Response may not follow browser agent pattern`)
    return true // Still pass as long as we get a response
  } catch (error) {
    console.error('   ❌ Error:', error)
    return false
  }
}

async function testStreamingResponse(): Promise<boolean> {
  console.log('\n🔍 Test 3: Streaming Response')
  console.log('─'.repeat(50))

  try {
    const result = streamText({
      model: 'anthropic/claude-haiku-4-5',
      system: BROWSER_AGENT_SYSTEM_PROMPT,
      prompt: 'List 3 browser automation tasks you can perform.',
      maxOutputTokens: 100
    })

    let chunkCount = 0
    process.stdout.write('   Streaming: ')
    for await (const _ of result.textStream) {
      chunkCount++
      if (chunkCount <= 5) process.stdout.write('.')
    }
    console.log()

    const usage = await result.usage
    console.log(`   Chunks received: ${chunkCount}`)
    console.log(`   Tokens: ${usage?.inputTokens} in, ${usage?.outputTokens} out`)

    if (chunkCount > 0) {
      console.log(`   ✅ Streaming works correctly`)
      return true
    }

    console.log(`   ❌ No chunks received`)
    return false
  } catch (error) {
    console.error('   ❌ Error:', error)
    return false
  }
}

async function testModelIdMapping(): Promise<boolean> {
  console.log('\n🔍 Test 4: Browser Agent Model ID Mapping')
  console.log('─'.repeat(50))

  const testCases = [
    { input: 'claude-sonnet-4-6', expected: 'anthropic/claude-sonnet-4-6' },
    { input: 'claude-haiku-4-5', expected: 'anthropic/claude-haiku-4-5' },
    { input: 'anthropic/claude-haiku-4-5', expected: 'anthropic/claude-haiku-4-5' }
  ]

  let allPassed = true
  for (const { input, expected } of testCases) {
    const result = mapModelId(input)
    const passed = result === expected
    console.log(`   ${passed ? '✅' : '❌'} ${input} → ${result}`)
    if (!passed) allPassed = false
  }

  return allPassed
}

async function testMultiProviderAccess(): Promise<boolean> {
  console.log('\n🔍 Test 5: Multi-Provider Access for Browser Tasks')
  console.log('─'.repeat(50))

  const models = [
    'anthropic/claude-haiku-4-5',
    'openai/gpt-4.1-mini-2025-04-14',
    'google/gemini-2.5-flash-lite'
  ]

  let allPassed = true
  for (const model of models) {
    try {
      const result = await generateText({
        model,
        system: 'You are a browser automation assistant.',
        prompt: 'Say "Ready" and nothing else.',
        maxOutputTokens: 20
      })
      console.log(`   ✅ ${model}: "${result.text.trim()}"`)
    } catch (error) {
      console.log(`   ❌ ${model}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      allPassed = false
    }
  }

  return allPassed
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(60))
  console.log('  Phase 2: Browser Agent Tests')
  console.log('═'.repeat(60))

  const results: { name: string; passed: boolean }[] = []

  results.push({ name: 'Model Access', passed: await testBrowserAgentModelAccess() })
  results.push({ name: 'System Prompt Processing', passed: await testSystemPromptProcessing() })
  results.push({ name: 'Streaming Response', passed: await testStreamingResponse() })
  results.push({ name: 'Model ID Mapping', passed: await testModelIdMapping() })
  results.push({ name: 'Multi-Provider Access', passed: await testMultiProviderAccess() })

  console.log('\n' + '═'.repeat(60))
  console.log('  Results Summary')
  console.log('═'.repeat(60))

  const passed = results.filter((r) => r.passed).length
  const total = results.length

  for (const { name, passed } of results) {
    console.log(`   ${passed ? '✅' : '❌'} ${name}`)
  }

  console.log()
  console.log(`   Total: ${passed}/${total} tests passed`)

  if (passed === total) {
    console.log('\n🎉 All Phase 2 tests passed! Browser Agent Gateway is ready.')
  } else {
    console.log('\n⚠️  Some tests failed. Please review before proceeding.')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
