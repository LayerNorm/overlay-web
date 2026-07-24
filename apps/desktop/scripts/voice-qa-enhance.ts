import { config } from 'dotenv'
import { enhanceTranscription } from '../src/main/services/llm-enhancer'

config({ path: '.env.local' })

const GROQ_API_KEY = process.env.GROQ_API_KEY
if (!GROQ_API_KEY) {
  console.error('No GROQ_API_KEY')
  process.exit(1)
}

const text = ` This is a simple recording. I'm just recording to test the transcription of my service and ideally it should be completely tolerant to long recordings that the user makes. Even if it is 10 minutes long, it should work without any issues. The transcription should be fast and accurate.`

async function run() {
  const start = Date.now()
  try {
    const result = await enhanceTranscription(text, undefined, GROQ_API_KEY)
    const elapsed = Date.now() - start
    console.log(`[QA] Enhancement succeeded in ${elapsed}ms`)
    console.log(`[QA] Result length: ${result.length}`)
    console.log(`[QA] Result:`, result)
  } catch (error: any) {
    console.error(`[QA] Enhancement failed:`, error?.message ?? error)
  }
}

run()
