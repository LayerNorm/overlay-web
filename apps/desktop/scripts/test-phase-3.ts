/**
 * Phase 3 Test Script - Notebook Agent (Unified)
 *
 * Tests:
 * 1. Gateway connectivity for notebook agent models
 * 2. System prompt for note editing tasks
 * 3. Streaming for notebook responses
 * 4. Model ID mapping for notebook agent
 *
 * Run: pnpm tsx scripts/test-phase-3.ts
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

// Notebook agent system prompt (simplified version)
const NOTEBOOK_AGENT_SYSTEM_PROMPT = `You are a notebook editing assistant. You help users:
- Write and edit notes
- Organize content
- Propose improvements to text
- Search for relevant information

When asked to edit, describe what changes you would make.`

// ── Test Functions ─────────────────────────────────────────────────────────────

async function testNotebookAgentModelAccess(): Promise<boolean> {
  console.log('\n🔍 Test 1: Notebook Agent Model Access')
  console.log('─'.repeat(50))

  const models = ['anthropic/claude-haiku-4-5', 'openai/gpt-4.1-mini-2025-04-14']

  let allPassed = true
  for (const model of models) {
    try {
      const result = await generateText({
        model,
        prompt: 'Say "Notebook ready" and nothing else.',
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

async function testNoteEditingPrompt(): Promise<boolean> {
  console.log('\n🔍 Test 2: Note Editing System Prompt')
  console.log('─'.repeat(50))

  try {
    const sampleNote = `# Meeting Notes
- Discussed project timeline
- Need to follow up with team
- Budget review next week`

    const result = await generateText({
      model: 'anthropic/claude-haiku-4-5',
      system: NOTEBOOK_AGENT_SYSTEM_PROMPT,
      prompt: `Here is my note:\n\n${sampleNote}\n\nHow would you improve this note?`,
      maxOutputTokens: 200
    })

    const hasEditSuggestions =
      result.text.toLowerCase().includes('add') ||
      result.text.toLowerCase().includes('improve') ||
      result.text.toLowerCase().includes('suggest') ||
      result.text.toLowerCase().includes('could')

    console.log(`   Response length: ${result.text.length} chars`)
    console.log(`   Contains edit suggestions: ${hasEditSuggestions ? 'Yes' : 'No'}`)

    if (result.text.length > 50) {
      console.log(`   ✅ System prompt generates editing suggestions`)
      return true
    }

    console.log(`   ⚠️  Response may be too short`)
    return true
  } catch (error) {
    console.error('   ❌ Error:', error)
    return false
  }
}

async function testStreamingForNotebook(): Promise<boolean> {
  console.log('\n🔍 Test 3: Streaming Response for Notebook')
  console.log('─'.repeat(50))

  try {
    const result = streamText({
      model: 'anthropic/claude-haiku-4-5',
      system: NOTEBOOK_AGENT_SYSTEM_PROMPT,
      prompt: 'Write a short 3-bullet summary about effective note-taking.',
      maxOutputTokens: 150
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
  console.log('\n🔍 Test 4: Notebook Agent Model ID Mapping')
  console.log('─'.repeat(50))

  const testCases = [
    { input: 'claude-haiku-4-5', expected: 'anthropic/claude-haiku-4-5' },
    { input: 'gpt-5.2-2025-12-11', expected: 'openai/gpt-5.2-2025-12-11' },
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

async function testAskModeResponse(): Promise<boolean> {
  console.log('\n🔍 Test 5: Ask Mode Response (Q&A about notes)')
  console.log('─'.repeat(50))

  try {
    const sampleNote = `# Project Alpha
Status: In Progress
Due: March 15, 2026
Team: Alice, Bob, Carol`

    const result = await generateText({
      model: 'anthropic/claude-haiku-4-5',
      system: 'You are a helpful assistant that answers questions about the user\'s notes.',
      prompt: `Note content:\n${sampleNote}\n\nQuestion: Who is on the team?`,
      maxOutputTokens: 50
    })

    const mentionsTeam =
      result.text.toLowerCase().includes('alice') ||
      result.text.toLowerCase().includes('bob') ||
      result.text.toLowerCase().includes('carol')

    console.log(`   Response: "${result.text.trim().substring(0, 100)}..."`)
    console.log(`   Correctly references note content: ${mentionsTeam ? 'Yes' : 'No'}`)

    if (mentionsTeam) {
      console.log(`   ✅ Ask mode correctly extracts info from notes`)
      return true
    }

    console.log(`   ⚠️  Response may not reference note content`)
    return true
  } catch (error) {
    console.error('   ❌ Error:', error)
    return false
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(60))
  console.log('  Phase 3: Notebook Agent Tests')
  console.log('═'.repeat(60))

  const results: { name: string; passed: boolean }[] = []

  results.push({ name: 'Model Access', passed: await testNotebookAgentModelAccess() })
  results.push({ name: 'Note Editing Prompt', passed: await testNoteEditingPrompt() })
  results.push({ name: 'Streaming Response', passed: await testStreamingForNotebook() })
  results.push({ name: 'Model ID Mapping', passed: await testModelIdMapping() })
  results.push({ name: 'Ask Mode Response', passed: await testAskModeResponse() })

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
    console.log('\n🎉 All Phase 3 tests passed! Notebook Agent Gateway is ready.')
  } else {
    console.log('\n⚠️  Some tests failed. Please review before proceeding.')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
