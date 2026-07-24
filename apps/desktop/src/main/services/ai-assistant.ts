import Groq from 'groq-sdk'

interface ProcessAssistantRequestOptions {
  instructions: string
  selectedText?: string | null
  screenshot?: string | null
  model?: string
  apiKey?: string
}

// Default assistant prompt - designed for direct text output
const DEFAULT_ASSISTANT_PROMPT = `You are a DIRECT-OUTPUT assistant. You help users by providing text that will be typed directly into their current application.

## YOUR FUNCTION
Respond to the user's request with text that is ready to be inserted immediately. Your output will be typed directly where the user's cursor is.

## MODES OF OPERATION

### 1. EDITING MODE (when selected text is provided)
You receive text to edit/rewrite based on instructions. Output ONLY the edited text.

### 2. GENERATION MODE (when no selected text)
You receive instructions to generate text. Output ONLY the requested content.

### 3. QUESTION MODE (when user asks a question)
Answer questions directly and helpfully. For questions, you MAY provide explanatory answers.
- If the question seems like it will be pasted somewhere (e.g., "answer this email", "reply to this"), give a direct answer ready to paste.
- If it's a genuine knowledge question, provide a helpful, concise answer.

## OUTPUT RULES
- For EDITING: Output ONLY the edited text. No preamble, no explanation.
- For GENERATION: Output ONLY the generated content. No "Here is" or "Sure, here's".
- For QUESTIONS: Answer directly. Skip phrases like "The answer is..." unless natural.
- NEVER start with: "Here is", "Sure!", "Of course!", "I'd be happy to", "Certainly!"
- NEVER end with: "Let me know if you need anything else", "Hope this helps!"
- Your output goes directly to the user's cursor - make it ready to use.

## EXAMPLES

User: "make this more formal: hey whats up, wanted to check in about the project"
Output: Hello, I hope this message finds you well. I wanted to follow up regarding the project status.

User: "write a thank you note for a gift"
Output: Thank you so much for the thoughtful gift! I really appreciate your kindness and generosity. It truly made my day.

User: "what's the capital of France"
Output: Paris

User: "explain quantum computing in one sentence"
Output: Quantum computing uses quantum mechanical phenomena like superposition and entanglement to perform calculations exponentially faster than classical computers for certain problems.`

// Editing-specific prompt
const EDITING_PROMPT = `You are a TEXT EDITOR. You rewrite/edit text based on instructions.

## CRITICAL RULES
- Output ONLY the edited text
- NO introductory phrases ("Here is the edited text", "I've rewritten it as")
- NO explanations of changes made
- NO concluding remarks
- Start directly with the edited content
- Preserve the intent while applying the requested changes

The user will provide: [INSTRUCTIONS]: [TEXT TO EDIT]
You respond with: [EDITED TEXT ONLY]`

export async function processAssistantRequest({
  instructions,
  selectedText,
  screenshot,
  model,
  apiKey
}: ProcessAssistantRequestOptions): Promise<string> {
  try {
    const groq = new Groq({ apiKey })

    const isEditingMode = selectedText != null && selectedText.length > 0

    const messages: Array<{
      role: 'system' | 'user' | 'assistant'
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
    }> = []

    // System prompt - use editing prompt for editing, assistant prompt for generation/questions
    const systemPrompt = isEditingMode ? EDITING_PROMPT : DEFAULT_ASSISTANT_PROMPT

    if (screenshot) {
      messages.push({
        role: 'system',
        content:
          systemPrompt +
          '\n\nA screenshot is provided for visual context. Use it to inform your response appropriately.'
      })
    } else {
      messages.push({
        role: 'system',
        content: systemPrompt
      })
    }

    // User message
    if (screenshot) {
      const contentArray: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        {
          type: 'text',
          text: isEditingMode ? `${instructions}: ${selectedText}` : instructions
        },
        {
          type: 'image_url',
          image_url: { url: screenshot }
        }
      ]
      messages.push({ role: 'user', content: contentArray })
    } else {
      // For editing mode, use the format expected by the prompt
      const userContent = isEditingMode ? `${instructions}: ${selectedText}` : instructions

      messages.push({ role: 'user', content: userContent })
    }

    // Map model to Groq-compatible model - openrouter models don't work with Groq SDK
    let selectedModel = model || 'llama-3.3-70b-versatile'
    if (selectedModel.startsWith('openrouter/') || selectedModel.includes(':free')) {
      // OpenRouter/free models should use Groq's default model
      selectedModel = 'llama-3.3-70b-versatile'
    }

    const completion = await groq.chat.completions.create({
      model: selectedModel,
      messages: messages as any,
      temperature: 0.3,
      max_tokens: 2000
    })

    let responseText = completion.choices[0]?.message?.content || ''

    // Post-processing: Strip common preamble patterns the LLM might add despite instructions
    responseText = responseText
      .replace(
        /^(Here('s| is| are)|Sure[!,]|Of course[!,]|Certainly[!,]|I'd be happy to|I can help)[^:]*[:.]\s*/i,
        ''
      )
      .replace(/\n\n(Let me know|Hope this helps|Feel free to)[^.]*\.?\s*$/i, '')
      .trim()

    return responseText
  } catch (error) {
    console.error('Error processing assistant request:', error)
    throw error
  }
}
