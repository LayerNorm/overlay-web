/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')

async function main() {
  const directory = path.join(__dirname, 'overlay-brand-approved')
  for (const kind of ['wordmark', 'icon']) {
    for (const color of ['black', 'white']) {
      const stem = path.join(directory, `overlay-${kind}-${color}`)
      const width = kind === 'wordmark' ? 2400 : 1024
      await sharp(await fs.readFile(`${stem}.svg`), { density: 144 })
        .resize({ width }).png().toFile(`${stem}.png`)
      const metadata = await sharp(`${stem}.png`).metadata()
      if (!metadata.hasAlpha || metadata.width !== width) throw new Error(`Invalid export: ${stem}`)
      console.log(`${path.basename(stem)}.png: ${metadata.width}×${metadata.height}, transparent`)
    }
  }
  const root = path.resolve(__dirname, '../../..')
  const icon = await fs.readFile(path.join(directory, 'overlay-icon-black.svg'))
  for (const [destination, width, height, markSize, background] of [
    ['public/assets/overlay-logo.png', 384, 384, 384, 'transparent'],
    ['src/assets/overlay-logo.png', 1024, 1024, 1024, 'transparent'],
    ['public/assets/overlay-share-thumb.png', 512, 512, 350, 'transparent'],
    ['public/assets/overlay-share-x-thumb.png', 512, 512, 350, 'white'],
    ['public/assets/overlay-share-linkedin-thumb.png', 1200, 627, 420, 'white'],
  ]) {
    const mark = await sharp(icon).resize(markSize, markSize).png().toBuffer()
    await sharp({ create: { width, height, channels: 4, background: background === 'transparent' ? '#00000000' : '#ffffff' } })
      .composite([{ input: mark, gravity: 'centre' }]).png().toFile(path.join(root, destination))
  }
  for (const [destination, size] of [['src/app/icon.png', 1024], ['docs/assets/favicon.png', 256]]) {
    const mark = await sharp(icon).resize(Math.round(size * 0.65)).png().toBuffer()
    const tile = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#fafafa"/></svg>`)
    await sharp(tile).composite([{ input: mark, gravity: 'centre' }]).png().toFile(path.join(root, destination))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
