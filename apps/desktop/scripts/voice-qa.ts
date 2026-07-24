import { createReadStream } from 'node:fs'
import { config } from 'dotenv'
import Groq from 'groq-sdk'

config({ path: '.env.local' })

const GROQ_API_KEY = process.env.GROQ_API_KEY
if (!GROQ_API_KEY) {
  console.error('No GROQ_API_KEY found')
  process.exit(1)
}

const filePath = 'scripts/test-recording.m4a'

async function run() {
  const groq = new Groq({ apiKey: GROQ_API_KEY, timeout: 180000, maxRetries: 0 })

  console.log(`[QA] Starting Groq transcription of ${filePath} ...`)
  const start = Date.now()
  try {
    const result = await groq.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
      temperature: 0,
    })
    const elapsed = Date.now() - start
    console.log(`[QA] Transcription succeeded in ${elapsed}ms`)
    console.log(`[QA] Text length: ${(result.text ?? '').length}`)
    console.log(`[QA] First 200 chars: ${(result.text ?? '').slice(0, 200)}`)
  } catch (error: any) {
    const elapsed = Date.now() - start
    console.error(`[QA] Transcription failed after ${elapsed}ms`)
    console.error(`[QA] Error:`, error?.message ?? error)
    if (error?.response) {
      console.error(`[QA] Status:`, error.response.status)
      console.error(`[QA] Body:`, error.response.data)
    }
  }
}

run()
