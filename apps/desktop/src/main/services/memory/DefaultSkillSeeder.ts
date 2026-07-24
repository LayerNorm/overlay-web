import * as path from 'path'
import { app } from 'electron'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'

interface DefaultSkill {
  id: string
  title: string
  skillMeta: Record<string, unknown>
  content: string
}

const DEFAULT_SKILLS: DefaultSkill[] = [
  {
    id: 'default-skill-make-pdf',
    title: 'Make PDF',
    skillMeta: {
      version: 1,
      status: 'active',
      triggers: [
        'make pdf',
        'create pdf',
        'generate pdf',
        'export pdf',
        'save as pdf',
        'pdf document'
      ],
      description:
        'Generate a PDF document from text, markdown, or HTML content using Python (reportlab or WeasyPrint).',
      scope: { global: true, folderIds: [] },
      inputs: [
        {
          name: 'content',
          description: 'Text, markdown, or HTML to convert to PDF',
          required: true
        },
        { name: 'output_path', description: 'Output file path for the PDF', required: false }
      ],
      source: { kind: 'manual' },
      executionMode: 'prompt-procedure',
      enabled: true,
      usageCount: 0,
      lastUsedAt: 0
    },
    content: `## Make PDF

Use this skill to generate a PDF document from text, markdown, or HTML content.

### Requirements
Install once: \`pip install reportlab weasyprint\`

### Procedure

1. **Determine the output path**: If the user didn't specify, use \`document.pdf\` in the working folder.

2. **Choose the right approach**:
   - Plain text / markdown → use **reportlab**
   - Styled HTML / CSS → use **WeasyPrint**

3. **reportlab (plain text / markdown)**:
\`\`\`python
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

CONTENT = """REPLACE_WITH_CONTENT"""
OUTPUT = "document.pdf"

doc = SimpleDocTemplate(OUTPUT, pagesize=letter,
                        leftMargin=inch, rightMargin=inch,
                        topMargin=inch, bottomMargin=inch)
styles = getSampleStyleSheet()
story = []
for line in CONTENT.splitlines():
    if line.strip():
        story.append(Paragraph(line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'),
                                styles['Normal']))
        story.append(Spacer(1, 0.12 * inch))
doc.build(story)
print(f"PDF saved: {OUTPUT}")
\`\`\`

4. **WeasyPrint (HTML/CSS content)**:
\`\`\`python
from weasyprint import HTML

html_content = """<!DOCTYPE html>
<html><head><style>
  body { font-family: system-ui, sans-serif; margin: 2cm; }
  h1 { color: #1a1a2e; }
</style></head>
<body>REPLACE_WITH_HTML</body></html>"""

HTML(string=html_content).write_pdf("document.pdf")
print("PDF saved: document.pdf")
\`\`\`

5. Run the script using the \`script_run\` tool with Python.

6. Confirm the output path and tell the user where the PDF was saved.

### Notes
- Always HTML-escape special characters (\`&\`, \`<\`, \`>\`) when using reportlab
- For markdown → HTML conversion use: \`pip install markdown\` then \`import markdown; html = markdown.markdown(text)\`
- WeasyPrint requires system fonts; it renders CSS faithfully
`
  },
  {
    id: 'default-skill-make-presentation',
    title: 'Make Presentation',
    skillMeta: {
      version: 1,
      status: 'active',
      triggers: [
        'make presentation',
        'create presentation',
        'make slides',
        'create slides',
        'powerpoint',
        'pptx',
        'slideshow',
        'make pptx'
      ],
      description:
        'Generate a PowerPoint (.pptx) presentation from structured content using python-pptx.',
      scope: { global: true, folderIds: [] },
      inputs: [
        {
          name: 'content',
          description: 'Topic, outline, or bullet points for the presentation',
          required: true
        },
        { name: 'output_path', description: 'Output .pptx file path', required: false }
      ],
      source: { kind: 'manual' },
      executionMode: 'prompt-procedure',
      enabled: true,
      usageCount: 0,
      lastUsedAt: 0
    },
    content: `## Make Presentation

Use this skill to create a PowerPoint (.pptx) presentation from topic/outline or structured content.

### Requirements
Install once: \`pip install python-pptx\`

### Procedure

1. **Plan the slides** based on the user's content. Typical structure:
   - Slide 1: Title slide (title + subtitle/author)
   - Slides 2–N: Content slides (heading + 4–6 bullet points each)
   - Last slide: Summary or "Thank you"

2. **Generate the presentation**:
\`\`\`python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

prs = Presentation()

# --- Title Slide ---
title_slide = prs.slides.add_slide(prs.slide_layouts[0])
title_slide.shapes.title.text = "REPLACE_TITLE"
title_slide.placeholders[1].text = "REPLACE_SUBTITLE"

# --- Helper to add a content slide ---
def add_slide(prs, heading, bullets):
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = heading
    tf = slide.placeholders[1].text_frame
    tf.clear()
    for i, bullet in enumerate(bullets):
        if i == 0:
            tf.paragraphs[0].text = bullet
        else:
            p = tf.add_paragraph()
            p.text = bullet
            p.level = 0

# --- Content Slides (replace with actual content) ---
add_slide(prs, "Slide 2 Heading", ["Bullet 1", "Bullet 2", "Bullet 3"])
add_slide(prs, "Slide 3 Heading", ["Bullet A", "Bullet B", "Bullet C"])

OUTPUT = "presentation.pptx"
prs.save(OUTPUT)
print(f"Presentation saved: {OUTPUT}")
\`\`\`

3. **Run** the script using the \`script_run\` tool with Python.

4. Confirm successful creation and report the output path.

### Notes
- Keep bullets concise: 6 words or fewer per point works best
- Use \`prs.slide_layouts[0]\` for title, \`[1]\` for title+content, \`[6]\` for blank
- Add images: \`slide.shapes.add_picture(img_path, left, top, width)\`
- python-pptx layouts 0–8 cover all standard PowerPoint layouts
`
  },
  {
    id: 'default-skill-html-to-presentation',
    title: 'HTML to Presentation',
    skillMeta: {
      version: 1,
      status: 'active',
      triggers: [
        'html to presentation',
        'html slides',
        'reveal.js',
        'web presentation',
        'html slideshow',
        'browser presentation'
      ],
      description:
        'Generate a self-contained HTML presentation (reveal.js) from topic or content — no installation required.',
      scope: { global: true, folderIds: [] },
      inputs: [
        { name: 'content', description: 'Topic or slide content/outline', required: true },
        { name: 'output_path', description: 'Output .html file path', required: false }
      ],
      source: { kind: 'manual' },
      executionMode: 'prompt-procedure',
      enabled: true,
      usageCount: 0,
      lastUsedAt: 0
    },
    content: `## HTML to Presentation

Use this skill to generate a self-contained HTML presentation using reveal.js (CDN-loaded — no install needed). The output opens directly in a browser.

### Procedure

1. **Plan the slides** from the user's content (same structure as Make Presentation).

2. **Generate the HTML file** using Python:
\`\`\`python
SLIDES = [
    {"title": "Presentation Title", "subtitle": "Subtitle / Author", "type": "title"},
    {"title": "Slide 2", "bullets": ["Point 1", "Point 2", "Point 3"]},
    {"title": "Slide 3", "bullets": ["Point A", "Point B", "Point C"]},
    {"title": "Thank You", "bullets": ["Questions?"]},
]

def build_slide(slide):
    if slide.get("type") == "title":
        return f"""<section>
  <h1>{slide['title']}</h1>
  <p>{slide.get('subtitle', '')}</p>
</section>"""
    bullets_html = "\\n".join(f"  <li>{b}</li>" for b in slide.get("bullets", []))
    return f"""<section>
  <h2>{slide['title']}</h2>
  <ul>{bullets_html}</ul>
</section>"""

slides_html = "\\n".join(build_slide(s) for s in SLIDES)

html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Presentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/black.css">
  <style>
    .reveal ul {{ text-align: left; }}
    .reveal h1, .reveal h2 {{ text-transform: none; }}
  </style>
</head>
<body>
  <div class="reveal"><div class="slides">
{slides_html}
  </div></div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
  <script>Reveal.initialize({{hash: true, transition: 'slide'}});</script>
</body>
</html>"""

OUTPUT = "presentation.html"
with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write(html)
print(f"Presentation saved: {OUTPUT}")
\`\`\`

3. **Run** the script using the \`script_run\` tool with Python.

4. Open the output HTML file in a browser. Press Space/Arrow keys to navigate slides.

### Notes
- Works offline once cached; first open requires internet (CDN)
- Themes: black, white, moon, sky, beige, serif, simple, solarized, blood, night
- Press \`F\` for fullscreen, \`S\` for speaker notes, \`O\` for overview
- Add speaker notes: \`<aside class="notes">Notes here</aside>\` inside a section
`
  }
]

export async function seedDefaultSkills(): Promise<void> {
  try {
    const notesDir = path.join(app.getPath('userData'), 'notes')
    if (!existsSync(notesDir)) {
      mkdirSync(notesDir, { recursive: true })
    }

    const now = Date.now()

    for (const skill of DEFAULT_SKILLS) {
      const filePath = path.join(notesDir, `${skill.id}.md`)

      // Skip if already seeded
      if (existsSync(filePath)) continue

      const meta = JSON.stringify({
        id: skill.id,
        title: skill.title,
        updatedAt: now,
        skill: skill.skillMeta
      })

      const fileContent = `---\n${meta}\n---\n${skill.content}`
      writeFileSync(filePath, fileContent, 'utf-8')
      console.log(`[DefaultSkillSeeder] Seeded skill: ${skill.title}`)

      console.log(`[DefaultSkillSeeder] Seeded skill file: ${skill.title}`)
    }
  } catch (err) {
    console.warn('[DefaultSkillSeeder] Failed to seed default skills:', err)
  }
}
