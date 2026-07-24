/**
 * Test script for MiniMax and OpenRouter API connectivity
 * Run with: npx tsx scripts/test-minimax-openrouter.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

interface TestResult {
  provider: string
  success: boolean
  message: string
  responseTime?: number
  response?: string
}

async function testMiniMax(): Promise<TestResult> {
  console.log('\n=== Testing MiniMax API ===')
  
  if (!MINIMAX_API_KEY) {
    return {
      provider: 'MiniMax',
      success: false,
      message: 'MINIMAX_API_KEY not found in .env file'
    }
  }

  console.log('API Key found:', MINIMAX_API_KEY.substring(0, 10) + '...')

  const startTime = Date.now()
  
  try {
    // MiniMax uses Anthropic-compatible API
    // Note: Direct Anthropic SDK uses baseURL without /v1 (SDK adds it)
    // AI SDK createAnthropic needs /v1 in baseURL (doesn't add it)
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    
    const client = new Anthropic({
      apiKey: MINIMAX_API_KEY,
      baseURL: 'https://api.minimax.io/anthropic'
    })

    console.log('Making test request to MiniMax...')
    
    const response = await client.messages.create({
      model: 'MiniMax-M2.5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Say "Hello from MiniMax!" and nothing else.' }]
    })

    const responseTime = Date.now() - startTime
    const textContent = response.content.find(c => c.type === 'text')
    const responseText = textContent ? textContent.text : 'No text response'

    console.log('✓ MiniMax API working!')
    console.log('  Response:', responseText)
    console.log('  Response time:', responseTime, 'ms')
    console.log('  Model:', response.model)
    console.log('  Usage:', response.usage)

    return {
      provider: 'MiniMax',
      success: true,
      message: 'API working correctly',
      responseTime,
      response: responseText
    }
  } catch (error: unknown) {
    const responseTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    console.log('✗ MiniMax API failed!')
    console.log('  Error:', errorMessage)
    console.log('  Time until error:', responseTime, 'ms')

    return {
      provider: 'MiniMax',
      success: false,
      message: errorMessage,
      responseTime
    }
  }
}

async function testOpenRouter(): Promise<TestResult> {
  console.log('\n=== Testing OpenRouter API ===')
  
  if (!OPENROUTER_API_KEY) {
    return {
      provider: 'OpenRouter',
      success: false,
      message: 'OPENROUTER_API_KEY not found in .env file'
    }
  }

  console.log('API Key found:', OPENROUTER_API_KEY.substring(0, 15) + '...')

  const startTime = Date.now()
  
  try {
    // OpenRouter uses OpenAI-compatible API
    const { default: OpenAI } = await import('openai')
    
    const client = new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1'
    })

    // First, test listing models to verify API key
    console.log('Listing available models...')
    const models = await client.models.list()
    console.log('  Found', models.data.length, 'models available')

    // Test with a free model
    console.log('Making test request with free model...')
    
    const response = await client.chat.completions.create({
      model: 'openrouter/free',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Say "Hello from OpenRouter!" and nothing else.' }]
    })

    const responseTime = Date.now() - startTime
    const responseText = response.choices[0]?.message?.content || 'No response'

    console.log('✓ OpenRouter API working!')
    console.log('  Response:', responseText)
    console.log('  Response time:', responseTime, 'ms')
    console.log('  Model:', response.model)
    console.log('  Usage:', response.usage)

    return {
      provider: 'OpenRouter',
      success: true,
      message: 'API working correctly',
      responseTime,
      response: responseText
    }
  } catch (error: unknown) {
    const responseTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    console.log('✗ OpenRouter API failed!')
    console.log('  Error:', errorMessage)
    console.log('  Time until error:', responseTime, 'ms')

    return {
      provider: 'OpenRouter',
      success: false,
      message: errorMessage,
      responseTime
    }
  }
}

async function testStreamingMiniMax(): Promise<TestResult> {
  console.log('\n=== Testing MiniMax Streaming ===')
  
  if (!MINIMAX_API_KEY) {
    return {
      provider: 'MiniMax (Streaming)',
      success: false,
      message: 'MINIMAX_API_KEY not found'
    }
  }

  const startTime = Date.now()
  
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    
    const client = new Anthropic({
      apiKey: MINIMAX_API_KEY,
      baseURL: 'https://api.minimax.io/anthropic'
    })

    console.log('Starting streaming request...')
    
    const stream = await client.messages.stream({
      model: 'MiniMax-M2.5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }]
    })

    let fullResponse = ''
    let chunkCount = 0

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        process.stdout.write(chunk.delta.text)
        fullResponse += chunk.delta.text
        chunkCount++
      }
    }

    const responseTime = Date.now() - startTime

    console.log('\n✓ MiniMax streaming working!')
    console.log('  Chunks received:', chunkCount)
    console.log('  Total response time:', responseTime, 'ms')

    return {
      provider: 'MiniMax (Streaming)',
      success: true,
      message: 'Streaming working correctly',
      responseTime,
      response: fullResponse
    }
  } catch (error: unknown) {
    const responseTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    console.log('✗ MiniMax streaming failed!')
    console.log('  Error:', errorMessage)

    return {
      provider: 'MiniMax (Streaming)',
      success: false,
      message: errorMessage,
      responseTime
    }
  }
}

async function testStreamingOpenRouter(): Promise<TestResult> {
  console.log('\n=== Testing OpenRouter Streaming ===')
  
  if (!OPENROUTER_API_KEY) {
    return {
      provider: 'OpenRouter (Streaming)',
      success: false,
      message: 'OPENROUTER_API_KEY not found'
    }
  }

  const startTime = Date.now()
  
  try {
    const { default: OpenAI } = await import('openai')
    
    const client = new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1'
    })

    console.log('Starting streaming request...')
    
    const stream = await client.chat.completions.create({
      model: 'openrouter/free',
      max_tokens: 100,
      stream: true,
      messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }]
    })

    let fullResponse = ''
    let chunkCount = 0

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        process.stdout.write(content)
        fullResponse += content
        chunkCount++
      }
    }

    const responseTime = Date.now() - startTime

    console.log('\n✓ OpenRouter streaming working!')
    console.log('  Chunks received:', chunkCount)
    console.log('  Total response time:', responseTime, 'ms')

    return {
      provider: 'OpenRouter (Streaming)',
      success: true,
      message: 'Streaming working correctly',
      responseTime,
      response: fullResponse
    }
  } catch (error: unknown) {
    const responseTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    console.log('✗ OpenRouter streaming failed!')
    console.log('  Error:', errorMessage)

    return {
      provider: 'OpenRouter (Streaming)',
      success: false,
      message: errorMessage,
      responseTime
    }
  }
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║       MiniMax & OpenRouter API Test Suite                    ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')

  console.log('\nEnvironment check:')
  console.log('  MINIMAX_API_KEY:', MINIMAX_API_KEY ? '✓ Found' : '✗ Not found')
  console.log('  OPENROUTER_API_KEY:', OPENROUTER_API_KEY ? '✓ Found' : '✗ Not found')

  const results: TestResult[] = []

  // Test basic API calls
  results.push(await testMiniMax())
  results.push(await testOpenRouter())

  // Test streaming
  results.push(await testStreamingMiniMax())
  results.push(await testStreamingOpenRouter())

  // Summary
  console.log('\n════════════════════════════════════════════════════════════════')
  console.log('                         TEST SUMMARY')
  console.log('════════════════════════════════════════════════════════════════')

  for (const result of results) {
    const status = result.success ? '✓ PASS' : '✗ FAIL'
    const time = result.responseTime ? ` (${result.responseTime}ms)` : ''
    console.log(`  ${status} ${result.provider}${time}`)
    if (!result.success) {
      console.log(`       └─ ${result.message}`)
    }
  }

  const passed = results.filter(r => r.success).length
  const total = results.length

  console.log('\n════════════════════════════════════════════════════════════════')
  console.log(`                    ${passed}/${total} tests passed`)
  console.log('════════════════════════════════════════════════════════════════')

  if (passed < total) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('\n❌ Test suite failed:', error)
  process.exit(1)
})
