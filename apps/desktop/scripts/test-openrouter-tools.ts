/**
 * Test file for OpenRouter tool calling with AI SDK
 * Run with: npx tsx scripts/test-openrouter-tools.ts
 * 
 * This tests:
 * 1. OpenRouter tool calling with compatibility mode
 * 2. Trinity model tool calling
 * 3. openrouter/free model tool calling
 */

import { generateText, tool } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

if (!OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY not found in environment')
  process.exit(1)
}

// Create OpenRouter provider with compatibility mode
// This forces Chat Completions API instead of Responses API
const openrouter = createOpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  compatibility: 'compatible', // Force Chat Completions API
  headers: {
    'HTTP-Referer': 'https://overlay.app',
    'X-Title': 'Overlay Tool Calling Test'
  }
})

// Simple test tools
const testTools = {
  get_weather: tool({
    description: 'Get the current weather for a location',
    parameters: z.object({
      location: z.string().describe('City name, e.g. "San Francisco"')
    }),
    execute: async ({ location }) => {
      console.log(`  🔧 Tool called: get_weather(${location})`)
      // Simulate weather API response
      return JSON.stringify({
        location,
        temperature: 72,
        conditions: 'sunny',
        humidity: 45
      })
    }
  }),

  search_web: tool({
    description: 'Search the web for information',
    parameters: z.object({
      query: z.string().describe('Search query')
    }),
    execute: async ({ query }) => {
      console.log(`  🔧 Tool called: search_web("${query}")`)
      // Simulate search results
      return JSON.stringify({
        results: [
          { title: `Result for: ${query}`, snippet: 'This is a simulated search result.' }
        ]
      })
    }
  }),

  task_complete: tool({
    description: 'Call this when the task is complete',
    parameters: z.object({
      summary: z.string().describe('Summary of what was accomplished')
    }),
    execute: async ({ summary }) => {
      console.log(`  ✅ Task complete: ${summary}`)
      return JSON.stringify({ success: true, summary })
    }
  })
}

// Models to test
const MODELS_TO_TEST = [
  { id: 'openrouter/free', name: 'Auto (Free Router)' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' } // Known good model for comparison
]

async function testModel(modelId: string, modelName: string): Promise<boolean> {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Testing: ${modelName}`)
  console.log(`Model ID: ${modelId}`)
  console.log('═'.repeat(60))

  try {
    const model = openrouter(modelId)

    console.log('\n📤 Sending request with tools...')
    const startTime = Date.now()

    const result = await generateText({
      model,
      system: 'You are a helpful assistant. Use the provided tools to complete tasks. Always call task_complete when done.',
      messages: [
        {
          role: 'user',
          content: 'What is the weather in San Francisco? After getting the weather, mark the task as complete.'
        }
      ],
      tools: testTools,
      toolChoice: 'auto',
      maxSteps: 5, // Allow multiple tool calls
      temperature: 0.3,
      onStepFinish: ({ text, toolCalls, toolResults, finishReason }) => {
        console.log(`\n  📍 Step finished:`)
        console.log(`     Finish reason: ${finishReason}`)
        console.log(`     Tool calls: ${toolCalls?.length || 0}`)
        console.log(`     Tool results: ${toolResults?.length || 0}`)
        console.log(`     Has text: ${!!text?.trim()}`)
        
        if (toolCalls && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            console.log(`     → Called: ${tc.toolName}`)
          }
        }
        
        if (text?.trim()) {
          console.log(`     Text: ${text.slice(0, 100)}...`)
        }
      }
    })

    const elapsed = Date.now() - startTime

    console.log(`\n📥 Response received in ${elapsed}ms`)
    console.log(`   Finish reason: ${result.finishReason}`)
    console.log(`   Steps: ${result.steps?.length || 0}`)
    console.log(`   Total tool calls: ${result.toolCalls?.length || 0}`)
    
    if (result.text) {
      console.log(`\n📝 Final text:\n${result.text.slice(0, 500)}`)
    }

    // Check if tools were actually called
    const totalToolCalls = (result.steps || []).reduce(
      (sum, s) => sum + (s.toolCalls?.length || 0),
      result.toolCalls?.length || 0
    )

    if (totalToolCalls > 0) {
      console.log(`\n✅ SUCCESS: Model made ${totalToolCalls} tool call(s)`)
      return true
    } else {
      console.log(`\n⚠️ WARNING: Model did not make any tool calls`)
      return false
    }

  } catch (error) {
    console.error(`\n❌ ERROR:`, error)
    
    // Parse error details
    if (error instanceof Error) {
      console.error(`   Name: ${error.name}`)
      console.error(`   Message: ${error.message}`)
      
      // Check for API-specific error properties
      const apiError = error as { 
        cause?: unknown
        data?: unknown
        status?: number
        responseBody?: string 
      }
      
      if (apiError.status) {
        console.error(`   HTTP Status: ${apiError.status}`)
      }
      if (apiError.data) {
        console.error(`   API Data:`, JSON.stringify(apiError.data).slice(0, 500))
      }
      if (apiError.responseBody) {
        console.error(`   Response Body:`, apiError.responseBody.slice(0, 500))
      }
    }
    
    return false
  }
}

async function main() {
  console.log('🧪 OpenRouter Tool Calling Test')
  console.log('================================\n')
  console.log('API Key:', OPENROUTER_API_KEY?.slice(0, 10) + '...')
  console.log('Using compatibility mode: compatible')
  console.log('Base URL: https://openrouter.ai/api/v1')

  const results: { model: string; success: boolean }[] = []

  for (const model of MODELS_TO_TEST) {
    const success = await testModel(model.id, model.name)
    results.push({ model: model.name, success })
  }

  console.log('\n\n' + '═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))
  
  for (const r of results) {
    console.log(`  ${r.success ? '✅' : '❌'} ${r.model}`)
  }

  const allPassed = results.every(r => r.success)
  console.log(`\n${allPassed ? '🎉 All tests passed!' : '⚠️ Some tests failed'}`)
  
  process.exit(allPassed ? 0 : 1)
}

main().catch(console.error)
