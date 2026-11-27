/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')

async function main() {
  const output = process.argv[2]
  if (!output || !fs.statSync(output).isDirectory())
    throw new Error('Pass an existing preview output directory.')
  await build({
    entryPoints: [path.join(__dirname, 'shell-preview.tsx')],
    bundle: true,
    outfile: path.join(output, 'preview.js'),
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      'react-native': 'react-native-web',
      react: path.dirname(require.resolve('react/package.json')),
      'react-dom': path.dirname(require.resolve('react-dom/package.json')),
    },
    resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
    define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true' },
  })
  fs.copyFileSync(
    require.resolve('@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf'),
    path.join(output, 'Geist.ttf'),
  )
  fs.copyFileSync(
    require.resolve('@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf'),
    path.join(output, 'GeistMedium.ttf'),
  )
  fs.copyFileSync(
    require.resolve('@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf'),
    path.join(output, 'GeistSemibold.ttf'),
  )
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Geist;src:url(Geist.ttf)}@font-face{font-family:GeistMedium;src:url(GeistMedium.ttf);font-weight:500}@font-face{font-family:GeistSemibold;src:url(GeistSemibold.ttf);font-weight:600}*{box-sizing:border-box}body{margin:0}#root{width:390px;height:844px}</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>',
  )
  console.log('Built React Native Web shell fixture preview: ' + output)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
