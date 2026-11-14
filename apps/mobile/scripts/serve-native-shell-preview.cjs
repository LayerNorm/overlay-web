/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http')
const { randomUUID } = require('node:crypto')

http
  .createServer(async (request, response) => {
    try {
      const params = new URL(request.url, 'http://localhost').searchParams
      const result = await fetch('http://127.0.0.1:8081/', {
        headers: { 'expo-platform': 'android', accept: 'application/expo+json' },
      })
      if (!result.ok) throw new Error('Start the local Expo dev client server on port 8081 first.')
      const manifest = await result.json()
      manifest.id = randomUUID()
      const bundle = new URL(manifest.launchAsset.url)
      bundle.host = '10.0.2.2:8081'
      bundle.pathname = '/scripts/native-shell-preview.bundle'
      manifest.launchAsset.url = bundle.toString()
      manifest.launchAsset.key = manifest.id
      manifest.extra.expoClient.extra = {
        ...manifest.extra.expoClient.extra,
        shellPreview: {
          screen: params.get('screen') ?? 'boot',
          theme: params.get('theme') ?? 'light',
        },
      }
      response.writeHead(200, { 'content-type': 'application/expo+json' })
      response.end(JSON.stringify(manifest))
    } catch (error) {
      response.writeHead(500)
      response.end(error.message)
    }
  })
  .listen(8032, '127.0.0.1', () =>
    console.log(
      'Native shell fixture manifest: http://10.0.2.2:8032/?screen=agents-drawer&theme=light',
    ),
  )
