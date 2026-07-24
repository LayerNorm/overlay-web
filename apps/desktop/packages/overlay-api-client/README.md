# @overlay/api-client

Typed client and validation contracts for Overlay Server's public `/api/v1`
surface.

```bash
npm install @overlay/api-client
```

```ts
import { createOverlayAppClient } from '@overlay/api-client'

const overlay = createOverlayAppClient({
  baseUrl: 'https://your-overlay-server.example',
  getAuthHeaders: async () => ({ Authorization: `Bearer ${accessToken}` })
})
```

Version `0.0.1` is included in this repository as a source workspace. Do not
assume the package is available from npm until an official provenance-bearing
publication exists.

License: Apache-2.0.
