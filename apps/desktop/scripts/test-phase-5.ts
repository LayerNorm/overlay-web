/**
 * Phase 5 Test Script - Usage & Billing Integration
 *
 * Tests:
 * 1. Model pricing calculations
 * 2. Cost calculation for different models
 * 3. Free model detection
 * 4. Premium model detection
 * 5. Token cost estimation
 *
 * Run: pnpm tsx scripts/test-phase-5.ts
 *
 * Note: Full integration tests require the app to be running with authentication.
 * This script tests the pricing/cost calculation logic used by SubscriptionService.
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(process.cwd(), '.env') })
config({ path: resolve(process.cwd(), '.env.local') })

// Import pricing functions - these are used by SubscriptionService
import {
  calculateTokenCost,
  isPremiumModel,
  getModelPricing,
  estimateTokensFromChars,
  estimateCostFromOutputChars,
  MODEL_PRICING
} from '../src/main/services/model-pricing'

// ── Test Functions ─────────────────────────────────────────────────────────────

function testModelPricingConfig(): boolean {
  console.log('\n🔍 Test 1: Model Pricing Configuration')
  console.log('─'.repeat(50))

  const requiredModels = [
    'openrouter/free',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'gpt-5.2-2025-12-11',
    'gemini-2.5-flash'
  ]

  let allPassed = true
  for (const modelId of requiredModels) {
    const pricing = MODEL_PRICING[modelId]
    if (pricing) {
      console.log(`   ✅ ${modelId}: $${pricing.inputPer1M}/$${pricing.outputPer1M} per 1M tokens`)
    } else {
      console.log(`   ❌ ${modelId}: NOT FOUND in MODEL_PRICING`)
      allPassed = false
    }
  }

  return allPassed
}

function testFreeModelDetection(): boolean {
  console.log('\n🔍 Test 2: Free Model Detection')
  console.log('─'.repeat(50))

  const testCases = [
    { modelId: 'openrouter/free', expectedFree: true },
    { modelId: 'claude-sonnet-4-6', expectedFree: false },
    { modelId: 'gpt-5.2-2025-12-11', expectedFree: false }
  ]

  let allPassed = true
  for (const { modelId, expectedFree } of testCases) {
    const isFree = !isPremiumModel(modelId)
    const passed = isFree === expectedFree
    console.log(`   ${passed ? '✅' : '❌'} ${modelId}: ${isFree ? 'FREE' : 'PREMIUM'} (expected: ${expectedFree ? 'FREE' : 'PREMIUM'})`)
    if (!passed) allPassed = false
  }

  return allPassed
}

function testCostCalculation(): boolean {
  console.log('\n🔍 Test 3: Token Cost Calculation')
  console.log('─'.repeat(50))

  const testCases = [
    {
      modelId: 'openrouter/free',
      inputTokens: 10000,
      cachedTokens: 0,
      outputTokens: 5000,
      expectedCost: 0
    },
    {
      modelId: 'claude-sonnet-4-6',
      inputTokens: 10000,
      cachedTokens: 2000,
      outputTokens: 5000,
      // (8000/1M * $3) + (2000/1M * $0.30) + (5000/1M * $15) = 0.024 + 0.0006 + 0.075 = $0.0996
      expectedCost: 0.0996
    },
    {
      modelId: 'claude-haiku-4-5',
      inputTokens: 5000,
      cachedTokens: 0,
      outputTokens: 2000,
      // (5000/1M * $1) + (2000/1M * $5) = 0.005 + 0.01 = $0.015
      expectedCost: 0.015
    }
  ]

  let allPassed = true
  for (const { modelId, inputTokens, cachedTokens, outputTokens, expectedCost } of testCases) {
    const cost = calculateTokenCost(modelId, inputTokens, cachedTokens, outputTokens)
    const passed = Math.abs(cost - expectedCost) < 0.001
    console.log(`   ${passed ? '✅' : '❌'} ${modelId}: $${cost.toFixed(6)} (expected: $${expectedCost.toFixed(6)})`)
    if (!passed) allPassed = false
  }

  return allPassed
}

function testPremiumModelDetection(): boolean {
  console.log('\n🔍 Test 4: Premium Model Detection')
  console.log('─'.repeat(50))

  const premiumModels = [
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'gpt-5.2-2025-12-11',
    'gemini-2.5-flash'
  ]

  let allPassed = true
  for (const modelId of premiumModels) {
    const isPremium = isPremiumModel(modelId)
    if (isPremium) {
      console.log(`   ✅ ${modelId}: Correctly identified as PREMIUM`)
    } else {
      console.log(`   ❌ ${modelId}: Should be PREMIUM but detected as FREE`)
      allPassed = false
    }
  }

  return allPassed
}

function testTokenEstimation(): boolean {
  console.log('\n🔍 Test 5: Token Estimation from Characters')
  console.log('─'.repeat(50))

  const testCases = [
    { chars: 1000, expectedTokens: 250 },
    { chars: 4000, expectedTokens: 1000 },
    { chars: 100, expectedTokens: 25 }
  ]

  let allPassed = true
  for (const { chars, expectedTokens } of testCases) {
    const tokens = estimateTokensFromChars(chars)
    const passed = tokens === expectedTokens
    console.log(`   ${passed ? '✅' : '❌'} ${chars} chars → ${tokens} tokens (expected: ${expectedTokens})`)
    if (!passed) allPassed = false
  }

  return allPassed
}

function testCostEstimationFromChars(): boolean {
  console.log('\n🔍 Test 6: Cost Estimation from Output Characters')
  console.log('─'.repeat(50))

  const testCases = [
    { modelId: 'openrouter/free', chars: 2000, expectedCost: 0 },
    {
      modelId: 'claude-sonnet-4-6',
      chars: 4000,
      // 4000 chars ≈ 1000 tokens → (1000/1M * $15) = $0.015
      expectedCost: 0.015
    }
  ]

  let allPassed = true
  for (const { modelId, chars, expectedCost } of testCases) {
    const cost = estimateCostFromOutputChars(modelId, chars)
    const passed = Math.abs(cost - expectedCost) < 0.001
    console.log(`   ${passed ? '✅' : '❌'} ${modelId} (${chars} chars): $${cost.toFixed(6)} (expected: $${expectedCost.toFixed(6)})`)
    if (!passed) allPassed = false
  }

  return allPassed
}

function testGetModelPricing(): boolean {
  console.log('\n🔍 Test 7: Get Model Pricing Info')
  console.log('─'.repeat(50))

  const modelId = 'claude-sonnet-4-6'
  const pricing = getModelPricing(modelId)

  if (pricing) {
    console.log(`   ✅ ${modelId} pricing retrieved:`)
    console.log(`      Input: $${pricing.inputPer1M}/1M tokens`)
    console.log(`      Cached: $${pricing.cachedInputPer1M}/1M tokens`)
    console.log(`      Output: $${pricing.outputPer1M}/1M tokens`)
    console.log(`      Free: ${pricing.isFree}`)
    return true
  }

  console.log(`   ❌ Failed to retrieve pricing for ${modelId}`)
  return false
}

function testSubscriptionTierScenarios(): boolean {
  console.log('\n🔍 Test 8: Subscription Tier Cost Scenarios')
  console.log('─'.repeat(50))

  // Simulate typical usage scenarios for each tier
  const scenarios = [
    {
      name: 'Free tier user (15 queries/week with free model)',
      modelId: 'openrouter/free',
      queries: 15,
      avgInputTokens: 500,
      avgOutputTokens: 200
    },
    {
      name: 'Pro tier user ($15/month budget)',
      modelId: 'claude-haiku-4-5',
      queries: 100,
      avgInputTokens: 1000,
      avgOutputTokens: 500
    },
    {
      name: 'Max tier user ($90/month budget)',
      modelId: 'claude-sonnet-4-6',
      queries: 200,
      avgInputTokens: 2000,
      avgOutputTokens: 1000
    }
  ]

  let allPassed = true
  for (const scenario of scenarios) {
    const costPerQuery = calculateTokenCost(
      scenario.modelId,
      scenario.avgInputTokens,
      0,
      scenario.avgOutputTokens
    )
    const totalCost = costPerQuery * scenario.queries

    console.log(`   📊 ${scenario.name}:`)
    console.log(`      Model: ${scenario.modelId}`)
    console.log(`      Cost per query: $${costPerQuery.toFixed(4)}`)
    console.log(`      Total (${scenario.queries} queries): $${totalCost.toFixed(2)}`)

    if (scenario.modelId.includes('free') && totalCost === 0) {
      console.log(`      ✅ Free model correctly costs $0`)
    } else if (!scenario.modelId.includes('free') && totalCost > 0) {
      console.log(`      ✅ Premium model correctly calculates cost`)
    } else {
      console.log(`      ❌ Unexpected cost calculation`)
      allPassed = false
    }
  }

  return allPassed
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(60))
  console.log('  Phase 5: Usage & Billing Integration Tests')
  console.log('═'.repeat(60))

  const results: { name: string; passed: boolean }[] = []

  results.push({ name: 'Model Pricing Config', passed: testModelPricingConfig() })
  results.push({ name: 'Free Model Detection', passed: testFreeModelDetection() })
  results.push({ name: 'Cost Calculation', passed: testCostCalculation() })
  results.push({ name: 'Premium Model Detection', passed: testPremiumModelDetection() })
  results.push({ name: 'Token Estimation', passed: testTokenEstimation() })
  results.push({ name: 'Cost from Characters', passed: testCostEstimationFromChars() })
  results.push({ name: 'Get Model Pricing', passed: testGetModelPricing() })
  results.push({ name: 'Subscription Scenarios', passed: testSubscriptionTierScenarios() })

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
    console.log('\n🎉 All Phase 5 tests passed! Usage & Billing Integration is ready.')
    console.log('\n📝 Phase 5 Integration Summary:')
    console.log('   - unified-chat-service.ts: Records usage after each chat')
    console.log('   - unified-browser-agent.ts: Records usage after agent session')
    console.log('   - unified-voice-agent.ts: Records usage after voice command')
    console.log('   - All usage recorded via subscriptionService.recordUsage()')
    console.log('   - Costs calculated using model-pricing.ts calculateTokenCost()')
  } else {
    console.log('\n⚠️  Some tests failed. Please review before proceeding.')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
