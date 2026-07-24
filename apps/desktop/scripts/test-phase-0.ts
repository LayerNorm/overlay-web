/**
 * Phase 0 Test Script - AI Gateway Foundation
 *
 * Tests:
 * 1. Gateway connectivity with basic text generation
 * 2. Streaming text generation
 * 3. Model ID mapping
 * 4. Free model detection
 *
 * Run: pnpm tsx scripts/test-phase-0.ts
 *
 * Prerequisites:
 * - AI_GATEWAY_API_KEY in .env or environment
 * - OPENROUTER_API_KEY in .env (for free model test)
 */

import { streamText, generateText } from 'ai'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(process.cwd(), '.env') })
config({ path: resolve(process.cwd(), '.env.local') })

// Inline implementations for standalone testing (avoid Electron dependencies)
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

// Free model IDs (openrouter/free is the ID in AVAILABLE_MODELS)
const FREE_MODEL_IDS = new Set(['openrouter/free'])

function mapModelId(modelId: string): string {
  if (modelId.includes('/')) return modelId
  return MODEL_ID_MAPPING[modelId] || modelId
}

function isFreeModel(modelId: string): boolean {
  return FREE_MODEL_IDS.has(modelId)
}

// ── Test Functions ─────────────────────────────────────────────────────────────

async function testGatewayCredits(): Promise<boolean> {
  console.log('\n🔍 Test 1: Gateway Credits Check')
  console.log('─'.repeat(50))

  try {
    const response = await fetch('https://ai-gateway.vercel.sh/v1/credits', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      console.error(`❌ Failed: ${response.status} ${response.statusText}`)
      return false
    }

    const credits = await response.json()
    console.log(`✅ Balance: $${credits.balance}`)
    console.log(`   Used: $${credits.total_used}`)
    return true
  } catch (error) {
    console.error('❌ Error:', error)
    return false
  }
}

async function testBasicGeneration(): Promise<boolean> {
  console.log('\n🔍 Test 2: Basic Text Generation (generateText)')
  console.log('─'.repeat(50))

  try {
    const result = await generateText({
      model: 'anthropic/claude-haiku-4-5',
      prompt: 'Say "Hello from AI Gateway" in exactly 5 words.',
      maxOutputTokens: 50
    })

    console.log(`✅ Response: ${result.text}`)
    console.log(`   Tokens: ${result.usage?.inputTokens} in, ${result.usage?.outputTokens} out`)
    return true
  } catch (error) {
    console.error('❌ Error:', error)
    return false
  }
}

async function testStreamingGeneration(): Promise<boolean> {
  console.log('\n🔍 Test 3: Streaming Text Generation (streamText)')
  console.log('─'.repeat(50))

  try {
    const result = streamText({
      model: 'anthropic/claude-haiku-4-5',
      prompt: 'Count from 1 to 5, one number per line.',
      maxOutputTokens: 50
    })

    process.stdout.write('   Streaming: ')
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk)
    }
    console.log()

    const usage = await result.usage
    console.log(`✅ Complete. Tokens: ${usage?.inputTokens} in, ${usage?.outputTokens} out`)
    return true
  } catch (error) {
    console.error('❌ Error:', error)
    return false
  }
}

async function testModelIdMapping(): Promise<boolean> {
  console.log('\n🔍 Test 4: Model ID Mapping')
  console.log('─'.repeat(50))

  const testCases = [
    { input: 'claude-haiku-4-5', expected: 'anthropic/claude-haiku-4-5' },
    { input: 'anthropic/claude-sonnet-4-6', expected: 'anthropic/claude-sonnet-4-6' },
    { input: 'gpt-5.2-2025-12-11', expected: 'openai/gpt-5.2-2025-12-11' }
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

async function testFreeModelDetection(): Promise<boolean> {
  console.log('\n🔍 Test 5: Free Model Detection')
  console.log('─'.repeat(50))

  const testCases = [
    { input: 'openrouter/free', expected: true },
    { input: 'anthropic/claude-haiku-4-5', expected: false },
    { input: 'openai/gpt-5.2', expected: false }
  ]

  let allPassed = true
  for (const { input, expected } of testCases) {
    const result = isFreeModel(input)
    const passed = result === expected
    console.log(`   ${passed ? '✅' : '❌'} ${input} → ${result ? 'FREE' : 'PAID'}`)
    if (!passed) allPassed = false
  }

  return allPassed
}

async function testMultipleProviders(): Promise<boolean> {
  console.log('\n🔍 Test 6: Multiple Provider Access')
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
        prompt: 'Say "OK" and nothing else.',
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
  console.log('  Phase 0: AI Gateway Foundation Tests')
  console.log('═'.repeat(60))

  const results: { name: string; passed: boolean }[] = []

  results.push({ name: 'Gateway Credits', passed: await testGatewayCredits() })
  results.push({ name: 'Basic Generation', passed: await testBasicGeneration() })
  results.push({ name: 'Streaming Generation', passed: await testStreamingGeneration() })
  results.push({ name: 'Model ID Mapping', passed: await testModelIdMapping() })
  results.push({ name: 'Free Model Detection', passed: await testFreeModelDetection() })
  results.push({ name: 'Multiple Providers', passed: await testMultipleProviders() })

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
    console.log('\n🎉 All Phase 0 tests passed! Ready for Phase 1.')
  } else {
    console.log('\n⚠️  Some tests failed. Please review before proceeding.')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
