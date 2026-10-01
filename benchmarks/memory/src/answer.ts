import { config } from './config'
import { benchText, withRetry } from './gateway'

/**
 * Fixed answering prompt — measures memory quality, not chat-product behavior.
 * Abstention is explicit: several benchmark categories score "I don't know"
 * as the correct behavior.
 */
export async function answerQuestion(args: {
  question: string
  memoryContext: string
  questionDate?: string
}): Promise<string> {
  const system = [
    'You are a personal assistant answering questions about a user.',
    'You are given a block of memories retrieved from the user\'s memory bank.',
    'Answer the question concisely using ONLY those memories.',
    'If the memories do not contain enough information to answer, say exactly: "I don\'t have that information."',
    'Do not use outside knowledge. Do not guess.',
  ].join(' ')

  const prompt = [
    args.memoryContext.trim() ? `Retrieved memories:\n${args.memoryContext}` : 'Retrieved memories: (none)',
    '',
    `Question${args.questionDate ? ` (asked on ${args.questionDate})` : ''}: ${args.question}`,
  ].join('\n')

  return await withRetry(
    () => benchText(config.answerModel, prompt, system),
    `answer:${args.question.slice(0, 40)}`,
  )
}
