import { createReadStream } from 'node:fs'
import { config } from 'dotenv'
import Groq from 'groq-sdk'

config({ path: '.env.local' })

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY!, timeout: 180000, maxRetries: 0 })

async function run() {
  const start = Date.now()
  const result = await groq.audio.transcriptions.create({
    file: createReadStream('scripts/test-recording.m4a'),
    model: 'whisper-large-v3-turbo',
    response_format: 'verbose_json',
    temperature: 0,
    prompt: 'Please spell these words exactly as written: Overlay, transcription.',
  })
  console.log(`Prompted verbose_json: ${Date.now() - start}ms`)
  console.log(`Text length: ${result.text.length}`)
}
run()
