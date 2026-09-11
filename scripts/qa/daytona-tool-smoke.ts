const DEFAULT_BASE_URL = process.env.DAYTONA_SMOKE_BASE_URL?.trim() || 'http://localhost:3000'
const DEFAULT_QUERY =
  'Can you please create a slideshow of four slides using HTML elements or Python and then export that slideshow into the outputs? the topic of the slideshow is venture capital funding for beginners, especially for seed round founders who are founding in consumer software as a service. Please use the Daytona sandbox for it.'
const DEFAULT_OUTPUT = 'outputs/venture-capital-funding-for-beginners-seed-consumer-saas.pptx'

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function getPythonCommand(): string {
  return [
    'if command -v python3 >/dev/null 2>&1; then',
    '  PYTHON_BIN=python3',
    'else',
    '  PYTHON_BIN=python',
    'fi',
    '"$PYTHON_BIN" -m pip install --quiet python-pptx',
    '"$PYTHON_BIN" "$OVERLAY_INLINE_CODE_PATH"',
  ].join('\n')
}

function getPythonCode(): string {
  return `
import os
from pptx import Presentation
from pptx.util import Inches, Pt

topic = "Venture Capital Funding for Beginners"
subtitle = "Seed-stage guidance for consumer SaaS founders"
output_dir = os.environ["OVERLAY_OUTPUT_DIR"]
output_path = os.path.join(output_dir, "venture-capital-funding-for-beginners-seed-consumer-saas.pptx")

slides = [
    {
        "title": "Seed Funding Basics",
        "bullets": [
            "Seed capital helps prove product demand before a full institutional scale-up.",
            "Consumer SaaS founders are usually raising for product iteration, growth loops, and early hiring.",
            "The goal is not just money, but a credible plan to reach repeatable traction.",
        ],
    },
    {
        "title": "What VCs Want to See",
        "bullets": [
            "A sharp consumer problem, a clear reason users return, and evidence the market is large enough.",
            "Early traction signals like retention, referral behavior, waitlists, or revenue growth matter more than polish.",
            "Founders should show why their distribution edge can compound over time.",
        ],
    },
    {
        "title": "Prepare the Round",
        "bullets": [
            "Build a simple deck: market, product, traction, business model, GTM, team, and ask.",
            "Know the exact use of funds and the milestones you expect to hit with 12 to 18 months of runway.",
            "Create a clean target list of angels and seed funds aligned with consumer and SaaS patterns.",
        ],
    },
    {
        "title": "Common Founder Mistakes",
        "bullets": [
            "Raising before a convincing story on retention or before knowing the main growth channel.",
            "Pitching too many features instead of one clear wedge and one believable growth thesis.",
            "Taking any term without understanding dilution, ownership targets, and future fundraising flexibility.",
        ],
    },
]

presentation = Presentation()
presentation.core_properties.title = topic
presentation.core_properties.subject = subtitle
presentation.core_properties.author = "Overlay Daytona Smoke Test"

for index, slide_data in enumerate(slides):
    layout = presentation.slide_layouts[1]
    slide = presentation.slides.add_slide(layout)
    slide.shapes.title.text = slide_data["title"]
    slide.placeholders[1].text = ""

    title_frame = slide.shapes.title.text_frame
    title_frame.paragraphs[0].font.size = Pt(28)
    title_frame.paragraphs[0].font.bold = True

    body = slide.placeholders[1]
    body.left = Inches(0.9)
    body.top = Inches(1.7)
    body.width = Inches(8.8)
    body.height = Inches(4.5)

    text_frame = body.text_frame
    text_frame.word_wrap = True
    text_frame.clear()

    for bullet_index, bullet in enumerate(slide_data["bullets"]):
        paragraph = text_frame.paragraphs[0] if bullet_index == 0 else text_frame.add_paragraph()
        paragraph.text = bullet
        paragraph.level = 0
        paragraph.font.size = Pt(20)

presentation.save(output_path)
print(f"Created slideshow at {output_path}")
`.trim()
}

async function main() {
  const userId =
    readArg('--user-id') ||
    process.env.DAYTONA_SMOKE_USER_ID?.trim() ||
    process.env.TEST_USER_ID?.trim()
  if (!userId) {
    throw new Error('Provide --user-id or DAYTONA_SMOKE_USER_ID')
  }

  const serverSecret = requireEnv('INTERNAL_API_SECRET')
  const baseUrl = readArg('--base-url') || DEFAULT_BASE_URL
  const query = readArg('--query') || DEFAULT_QUERY
  const outputPath = readArg('--output-path') || DEFAULT_OUTPUT

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 240_000)

  try {
    console.log('[daytona smoke] starting', { baseUrl, userId, outputPath })

    const response = await fetch(`${baseUrl}/api/v1/daytona/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-secret': serverSecret,
      },
      body: JSON.stringify({
        userId,
        serverSecret,
        task: query,
        runtime: 'python',
        command: getPythonCommand(),
        code: getPythonCode(),
        expectedOutputs: [outputPath],
      }),
      signal: controller.signal,
    })

    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean
      exitCode?: number
      stdout?: string
      stderr?: string
      artifacts?: Array<{
        outputId: string
        fileName: string
        mimeType?: string
        sizeBytes?: number
        type?: string
      }>
      message?: string
      error?: string
    }

    console.log('[daytona smoke] response status', response.status)
    console.log('[daytona smoke] message', payload.message || payload.error || '')
    if (payload.stdout) {
      console.log('[daytona smoke] stdout\n' + payload.stdout)
    }
    if (payload.stderr) {
      console.log('[daytona smoke] stderr\n' + payload.stderr)
    }

    if (!response.ok || !payload.success) {
      throw new Error(payload.message || payload.error || `Smoke test failed with HTTP ${response.status}`)
    }

    if (!Array.isArray(payload.artifacts) || payload.artifacts.length === 0) {
      throw new Error('Smoke test succeeded but returned no artifacts.')
    }

    const artifact = payload.artifacts[0]
    console.log('[daytona smoke] artifact', artifact)
  } finally {
    clearTimeout(timeoutId)
  }
}

void main().catch((error) => {
  console.error('[daytona smoke] failed', error)
  process.exit(1)
})
