import { readdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const logosDir = join(__dirname, '..', 'assets', 'model-logos')

async function main() {
  const entries = await readdir(logosDir)
  const svgFiles = entries.filter((f) => f.endsWith('.svg'))
  for (const file of svgFiles) {
    const inputPath = join(logosDir, file)
    const outputPath = join(logosDir, file.replace('.svg', '.png'))
    await sharp(inputPath, { density: 300 })
      .resize(64, 64, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outputPath)
    console.log(`Converted ${file} -> ${file.replace('.svg', '.png')}`)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
