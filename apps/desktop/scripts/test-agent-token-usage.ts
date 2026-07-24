/**
 * Test script to verify token usage extraction from different SDKs
 * 
 * Run with: npx ts-node scripts/test-agent-token-usage.ts
 * 
 * This script tests:
 * 1. Anthropic SDK token extraction
 * 2. Vercel AI SDK token extraction
 * 3. OpenRouter direct API token extraction
 * 4. Cost calculation using model-pricing.ts
 */

import Anthropic from '@anthropic-ai/sdk'
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { MODEL_PRICING, calculateTokenCost, isPremiumModel } from '../src/main/services/model-pricing'

// ============ TYPES ============

interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

interface TestResult {
  sdk: string
  model: string
  usage: TokenUsage | null
  calculatedCost: number
  rawUsage: unknown
  error?: string
}

// ============ TEST FUNCTIONS ============

/**
 * Test Anthropic SDK token extraction
 */
async function testAnthropicSDK(apiKey: string): Promise<TestResult> {
  console.log('\n=== Testing Anthropic SDK ===')
  
  const client = new Anthropic({ apiKey })
  const model = 'claude-haiku-4-5'
  
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Say hello in exactly 10 words.' }]
    })
    
    // Extract usage from response
    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: 0 // Anthropic returns cache_creation_input_tokens and cache_read_input_tokens separately
    }
    
    // Check for cache tokens if available
    if ('cache_read_input_tokens' in response.usage) {
      usage.cachedTokens = (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens || 0
    }
    
    const cost = calculateTokenCost(model, usage.inputTokens, usage.cachedTokens, usage.outputTokens)
    
    console.log(`✓ Anthropic SDK Response:`)
    console.log(`  Input tokens: ${usage.inputTokens}`)
    console.log(`  Output tokens: ${usage.outputTokens}`)
    console.log(`  Cached tokens: ${usage.cachedTokens}`)
    console.log(`  Calculated cost: $${cost.toFixed(6)}`)
    
    return {
      sdk: 'Anthropic SDK',
      model,
      usage,
      calculatedCost: cost,
      rawUsage: response.usage
    }
  } catch (error) {
    console.error(`✗ Anthropic SDK Error:`, error)
    return {
      sdk: 'Anthropic SDK',
      model,
      usage: null,
      calculatedCost: 0,
      rawUsage: null,
      error: String(error)
    }
  }
}

/**
 * Test Vercel AI SDK token extraction
 */
async function testVercelAISDK(apiKey: string): Promise<TestResult> {
  console.log('\n=== Testing Vercel AI SDK (with Anthropic provider) ===')
  
  const model = 'claude-haiku-4-5'
  
  try {
    const anthropic = createAnthropic({ apiKey })
    
    const result = await generateText({
      model: anthropic(model),
      prompt: 'Say hello in exactly 10 words.'
    })
    
    // Vercel AI SDK uses promptTokens and completionTokens
    const usage: TokenUsage = {
      inputTokens: result.usage?.promptTokens || 0,
      outputTokens: result.usage?.completionTokens || 0,
      cachedTokens: 0
    }
    
    const cost = calculateTokenCost(model, usage.inputTokens, usage.cachedTokens, usage.outputTokens)
    
    console.log(`✓ Vercel AI SDK Response:`)
    console.log(`  Prompt tokens: ${usage.inputTokens}`)
    console.log(`  Completion tokens: ${usage.outputTokens}`)
    console.log(`  Total tokens: ${result.usage?.totalTokens || 0}`)
    console.log(`  Calculated cost: $${cost.toFixed(6)}`)
    
    return {
      sdk: 'Vercel AI SDK',
      model,
      usage,
      calculatedCost: cost,
      rawUsage: result.usage
    }
  } catch (error) {
    console.error(`✗ Vercel AI SDK Error:`, error)
    return {
      sdk: 'Vercel AI SDK',
      model,
      usage: null,
      calculatedCost: 0,
      rawUsage: null,
      error: String(error)
    }
  }
}

/**
 * Test OpenRouter direct API token extraction
 */
async function testOpenRouterDirect(apiKey: string): Promise<TestResult> {
  console.log('\n=== Testing OpenRouter Direct API ===')
  
  const model = 'anthropic/claude-3-haiku'
  
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://overlay.app',
        'X-Title': 'Overlay Token Test'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say hello in exactly 10 words.' }],
        max_tokens: 100
      })
    })
    
    const data = await response.json() as {
      usage?: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
      }
      error?: { message: string }
    }
    
    if (data.error) {
      throw new Error(data.error.message)
    }
    
    // OpenRouter uses OpenAI-compatible format
    const usage: TokenUsage = {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      cachedTokens: 0
    }
    
    // Note: OpenRouter model IDs don't match our MODEL_PRICING keys
    // We need to map them or use a fallback
    const cost = calculateTokenCost(model, usage.inputTokens, usage.cachedTokens, usage.outputTokens)
    
    console.log(`✓ OpenRouter Direct API Response:`)
    console.log(`  Prompt tokens: ${usage.inputTokens}`)
    console.log(`  Completion tokens: ${usage.outputTokens}`)
    console.log(`  Total tokens: ${data.usage?.total_tokens || 0}`)
    console.log(`  Calculated cost: $${cost.toFixed(6)} (may be 0 if model not in pricing table)`)
    
    return {
      sdk: 'OpenRouter Direct',
      model,
      usage,
      calculatedCost: cost,
      rawUsage: data.usage
    }
  } catch (error) {
    console.error(`✗ OpenRouter Direct API Error:`, error)
    return {
      sdk: 'OpenRouter Direct',
      model,
      usage: null,
      calculatedCost: 0,
      rawUsage: null,
      error: String(error)
    }
  }
}

/**
 * Test Vercel AI SDK with OpenRouter provider
 */
async function testVercelAISDKOpenRouter(apiKey: string): Promise<TestResult> {
  console.log('\n=== Testing Vercel AI SDK (with OpenRouter provider) ===')
  
  const model = 'anthropic/claude-3-haiku'
  
  try {
    const openrouter = createOpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'HTTP-Referer': 'https://overlay.app',
        'X-Title': 'Overlay Token Test'
      }
    })
    
    const result = await generateText({
      model: openrouter(model),
      prompt: 'Say hello in exactly 10 words.'
    })
    
    const usage: TokenUsage = {
      inputTokens: result.usage?.promptTokens || 0,
      outputTokens: result.usage?.completionTokens || 0,
      cachedTokens: 0
    }
    
    const cost = calculateTokenCost(model, usage.inputTokens, usage.cachedTokens, usage.outputTokens)
    
    console.log(`✓ Vercel AI SDK + OpenRouter Response:`)
    console.log(`  Prompt tokens: ${usage.inputTokens}`)
    console.log(`  Completion tokens: ${usage.outputTokens}`)
    console.log(`  Total tokens: ${result.usage?.totalTokens || 0}`)
    console.log(`  Calculated cost: $${cost.toFixed(6)} (may be 0 if model not in pricing table)`)
    
    return {
      sdk: 'Vercel AI SDK + OpenRouter',
      model,
      usage,
      calculatedCost: cost,
      rawUsage: result.usage
    }
  } catch (error) {
    console.error(`✗ Vercel AI SDK + OpenRouter Error:`, error)
    return {
      sdk: 'Vercel AI SDK + OpenRouter',
      model,
      usage: null,
      calculatedCost: 0,
      rawUsage: null,
      error: String(error)
    }
  }
}

/**
 * Test cost calculation logic
 */
function testCostCalculation(): void {
  console.log('\n=== Testing Cost Calculation ===')
  
  const testCases = [
    { model: 'claude-sonnet-4-6', input: 10000, cached: 2000, output: 5000 },
    { model: 'claude-haiku-4-5', input: 5000, cached: 0, output: 2000 },
    { model: 'gpt-5.2-2025-12-11', input: 5000, cached: 0, output: 2000 },
    { model: 'openrouter/free', input: 10000, cached: 0, output: 5000 },
    { model: 'unknown-model', input: 1000, cached: 0, output: 500 }
  ]
  
  for (const tc of testCases) {
    const cost = calculateTokenCost(tc.model, tc.input, tc.cached, tc.output)
    const isPremium = isPremiumModel(tc.model)
    const pricing = MODEL_PRICING[tc.model]
    
    console.log(`\n${tc.model}:`)
    console.log(`  Input: ${tc.input}, Cached: ${tc.cached}, Output: ${tc.output}`)
    console.log(`  Is Premium: ${isPremium}`)
    console.log(`  Has Pricing: ${!!pricing}`)
    console.log(`  Calculated Cost: $${cost.toFixed(6)}`)
    
    if (pricing && !pricing.isFree) {
      const uncachedInput = tc.input - tc.cached
      const expectedCost = 
        (uncachedInput / 1_000_000) * pricing.inputPer1M +
        (tc.cached / 1_000_000) * pricing.cachedInputPer1M +
        (tc.output / 1_000_000) * pricing.outputPer1M
      console.log(`  Expected Cost: $${expectedCost.toFixed(6)}`)
      console.log(`  Match: ${Math.abs(cost - expectedCost) < 0.000001 ? '✓' : '✗'}`)
    }
  }
}

// ============ MAIN ============

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║         Agent Token Usage Test Script                      ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  
  // Get API keys from environment
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openrouterKey = process.env.OPENROUTER_API_KEY
  
  const results: TestResult[] = []
  
  // Test cost calculation (no API keys needed)
  testCostCalculation()
  
  // Test Anthropic SDK
  if (anthropicKey) {
    results.push(await testAnthropicSDK(anthropicKey))
    results.push(await testVercelAISDK(anthropicKey))
  } else {
    console.log('\n⚠ ANTHROPIC_API_KEY not set, skipping Anthropic tests')
  }
  
  // Test OpenRouter
  if (openrouterKey) {
    results.push(await testOpenRouterDirect(openrouterKey))
    results.push(await testVercelAISDKOpenRouter(openrouterKey))
  } else {
    console.log('\n⚠ OPENROUTER_API_KEY not set, skipping OpenRouter tests')
  }
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║                      Summary                               ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  
  for (const result of results) {
    if (result.error) {
      console.log(`✗ ${result.sdk} (${result.model}): FAILED - ${result.error.slice(0, 50)}`)
    } else {
      console.log(`✓ ${result.sdk} (${result.model}): ${result.usage?.inputTokens} in / ${result.usage?.outputTokens} out = $${result.calculatedCost.toFixed(6)}`)
    }
  }
  
  console.log('\n=== Test Complete ===')
}

main().catch(console.error)
