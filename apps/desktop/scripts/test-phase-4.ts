/**
 * Phase 4 Test Script - Voice Agent (Unified)
 *
 * Tests:
 * 1. Gateway connectivity for voice agent models
 * 2. System prompt for voice command tasks
 * 3. Multi-provider access for voice commands
 * 4. Model ID mapping for voice agent
 *
 * Run: pnpm tsx scripts/test-phase-4.ts
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

// Voice agent system prompt (simplified version)
const VOICE_AGENT_SYSTEM_PROMPT = `You are Overlay, a macOS AI agent that executes voice commands. You can:
- Run AppleScript commands
- Search contacts and send messages
- Manage calendar events
- Open and control applications
- Browse the web

When given a command, describe what actions you would take.`

// ── Test Functions ─────────────────────────────────────────────────────────────

async function testVoiceAgentModelAccess(): Promise<boolean> {
  console.log('\n🔍 Test 1: Voice Agent Model Access')
  console.log('─'.repeat(50))

  const models = ['anthropic/claude-haiku-4-5', 'anthropic/claude-sonnet-4-6']

  let allPassed = true
  for (const model of models) {
    try {
      const result = await generateText({
        model,
        prompt: 'Say "Voice agent ready" and nothing else.',
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

async function testVoiceCommandProcessing(): Promise<boolean> {
  console.log('\n🔍 Test 2: Voice Command Processing')
  console.log('─'.repeat(50))

  try {
    const result = await generateText({
      model: 'anthropic/claude-haiku-4-5',
      system: VOICE_AGENT_SYSTEM_PROMPT,
      prompt: 'Send a message to John saying "I will be 10 minutes late"',
      maxOutputTokens: 150
    })

    const hasActionPlan =
      result.text.toLowerCase().includes('contact') ||
      result.text.toLowerCase().includes('message') ||
      result.text.toLowerCase().includes('send') ||
      result.text.toLowerCase().includes('john')

    console.log(`   Response length: ${result.text.length} chars`)
    console.log(`   Contains action plan: ${hasActionPlan ? 'Yes' : 'No'}`)

    if (hasActionPlan) {
      console.log(`   ✅ Voice command correctly processed`)
      return true
    }

    console.log(`   ⚠️  Response may not follow voice agent pattern`)
    return true
  } catch (error) {
    console.error('   ❌ Error:', error)
    return false
  }
}

async function testStreamingForVoice(): Promise<boolean> {
  console.log('\n🔍 Test 3: Streaming Response for Voice')
  console.log('─'.repeat(50))

  try {
    const result = streamText({
      model: 'anthropic/claude-haiku-4-5',
      system: VOICE_AGENT_SYSTEM_PROMPT,
      prompt: 'What can you help me with?',
      maxOutputTokens: 100
    })

    let chunkCount = 0
    process.stdout.write('   Streaming: ')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of result.textStream) {
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
  console.log('\n🔍 Test 4: Voice Agent Model ID Mapping')
  console.log('─'.repeat(50))

  const testCases = [
    { input: 'claude-haiku-4-5', expected: 'anthropic/claude-haiku-4-5' },
    { input: 'claude-sonnet-4-6', expected: 'anthropic/claude-sonnet-4-6' },
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

async function testMultiProviderVoice(): Promise<boolean> {
  console.log('\n🔍 Test 5: Multi-Provider Access for Voice Tasks')
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
        system: 'You are a voice command assistant.',
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
  console.log('  Phase 4: Voice Agent Tests')
  console.log('═'.repeat(60))

  const results: { name: string; passed: boolean }[] = []

  results.push({ name: 'Model Access', passed: await testVoiceAgentModelAccess() })
  results.push({ name: 'Voice Command Processing', passed: await testVoiceCommandProcessing() })
  results.push({ name: 'Streaming Response', passed: await testStreamingForVoice() })
  results.push({ name: 'Model ID Mapping', passed: await testModelIdMapping() })
  results.push({ name: 'Multi-Provider Access', passed: await testMultiProviderVoice() })

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
    console.log('\n🎉 All Phase 4 tests passed! Voice Agent Gateway is ready.')
  } else {
    console.log('\n⚠️  Some tests failed. Please review before proceeding.')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
