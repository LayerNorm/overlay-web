import Anthropic from '@anthropic-ai/sdk'
import Groq from 'groq-sdk'
import { keyCacheService } from '../key-cache-service'

// Claude Sonnet 4 context window: 200K tokens
const MAX_CONTEXT_TOKENS = 200000
const SUMMARIZATION_THRESHOLD = 0.9 // Trigger at 90%
const SUMMARIZER_MODEL = 'llama-3.3-70b-versatile'

// Rough token estimation (4 chars ≈ 1 token for English text)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Estimate tokens for a message content block
function estimateContentBlockTokens(content: string | Anthropic.ContentBlockParam[]): number {
  if (typeof content === 'string') {
    return estimateTokens(content)
  }

  let total = 0
  for (const block of content) {
    if (block.type === 'text') {
      total += estimateTokens(block.text)
    } else if (block.type === 'image') {
      // Images use ~765 tokens for low-res, ~1105 for high-res
      // Estimate conservatively at 1500 per image
      total += 1500
    } else if (block.type === 'tool_use') {
      total += estimateTokens(JSON.stringify(block.input || {})) + 50
    } else if (block.type === 'tool_result') {
      if (typeof block.content === 'string') {
        total += estimateTokens(block.content)
      } else if (Array.isArray(block.content)) {
        for (const item of block.content) {
          if (item.type === 'text') {
            total += estimateTokens(item.text)
          } else if (item.type === 'image') {
            total += 1500
          }
        }
      }
    }
  }
  return total
}

// Estimate total tokens for messages array
export function estimateMessagesTokens(messages: Anthropic.MessageParam[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateContentBlockTokens(msg.content)
    total += 10 // Role/structure overhead
  }
  return total
}

// Check if we need to summarize
export function needsSummarization(
  messages: Anthropic.MessageParam[],
  systemPromptTokens: number
): boolean {
  const messageTokens = estimateMessagesTokens(messages)
  const totalTokens = messageTokens + systemPromptTokens
  const threshold = MAX_CONTEXT_TOKENS * SUMMARIZATION_THRESHOLD

  console.log(
    `[ContextManager] Token usage: ${totalTokens}/${MAX_CONTEXT_TOKENS} (${((totalTokens / MAX_CONTEXT_TOKENS) * 100).toFixed(1)}%)`
  )

  return totalTokens >= threshold
}

// Format messages for summarization
function formatMessagesForSummary(messages: Anthropic.MessageParam[]): string {
  const parts: string[] = []

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant'

    if (typeof msg.content === 'string') {
      parts.push(`${role}: ${msg.content}`)
    } else {
      const contentParts: string[] = []
      for (const block of msg.content) {
        if (block.type === 'text') {
          contentParts.push(block.text)
        } else if (block.type === 'tool_use') {
          contentParts.push(
            `[Tool: ${block.name}] Input: ${JSON.stringify(block.input).slice(0, 200)}...`
          )
        } else if (block.type === 'tool_result') {
          const resultText =
            typeof block.content === 'string' ? block.content.slice(0, 300) : '[complex content]'
          contentParts.push(`[Tool Result] ${resultText}...`)
        } else if (block.type === 'image') {
          contentParts.push('[Image]')
        }
      }
      parts.push(`${role}: ${contentParts.join('\n')}`)
    }
  }

  return parts.join('\n\n')
}

// Summarize conversation history using Llama 3.3 70b via Groq
export async function summarizeConversation(
  messages: Anthropic.MessageParam[],
  originalCommand: string
): Promise<{ summary: string; preserveLastN: number }> {
  const groqKey = await keyCacheService.getKey('groq')
  if (!groqKey) {
    console.log('[ContextManager] No Groq API key, skipping summarization')
    // Return a basic summary from the messages
    return {
      summary: `Continuing task: ${originalCommand}. Previous steps have been executed.`,
      preserveLastN: 4
    }
  }

  const groq = new Groq({ apiKey: groqKey })
  const formattedHistory = formatMessagesForSummary(messages)

  try {
    console.log('[ContextManager] Summarizing conversation with Llama 3.3 70b...')

    const response = await groq.chat.completions.create({
      model: SUMMARIZER_MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: 'system',
          content: `You are a conversation summarizer for an AI agent. Your task is to create a concise but comprehensive summary of the agent's progress on a task.

The summary should include:
1. The original user request/command
2. Key actions taken so far (tools used, their results)
3. Current state/progress toward the goal
4. Any important context or findings
5. What still needs to be done

Keep the summary focused and actionable. The agent will use this to continue the task.`
        },
        {
          role: 'user',
          content: `Original command: ${originalCommand}

Conversation history to summarize:
${formattedHistory}

Please provide a structured summary that captures the essential progress and context.`
        }
      ]
    })

    const summary = response.choices[0]?.message?.content || 'Summary unavailable'
    console.log('[ContextManager] Summary generated:', summary.slice(0, 200) + '...')

    return {
      summary,
      preserveLastN: 4 // Keep last 4 messages for immediate context
    }
  } catch (error) {
    console.error('[ContextManager] Summarization failed:', error)
    return {
      summary: `Continuing task: ${originalCommand}. Previous steps completed.`,
      preserveLastN: 4
    }
  }
}

// Compress messages by replacing old ones with a summary
export async function compressMessages(
  messages: Anthropic.MessageParam[],
  originalCommand: string
): Promise<Anthropic.MessageParam[]> {
  if (messages.length <= 6) {
    // Not enough messages to compress
    return messages
  }

  const { summary, preserveLastN } = await summarizeConversation(messages, originalCommand)

  // Keep the original user command and last N messages
  const recentMessages = messages.slice(-preserveLastN)

  // Create compressed history
  const compressedMessages: Anthropic.MessageParam[] = [
    // Original command
    { role: 'user', content: originalCommand },
    // Summary of what happened
    {
      role: 'assistant',
      content: `[CONTEXT SUMMARY - Previous conversation compressed due to length]\n\n${summary}\n\n[END SUMMARY - Continuing with task...]`
    },
    // Recent messages
    ...recentMessages
  ]

  const oldTokens = estimateMessagesTokens(messages)
  const newTokens = estimateMessagesTokens(compressedMessages)
  console.log(
    `[ContextManager] Compressed messages: ${oldTokens} -> ${newTokens} tokens (${((1 - newTokens / oldTokens) * 100).toFixed(1)}% reduction)`
  )

  return compressedMessages
}
