import 'server-only'

import type { ObjectStore, ObjectSummary } from '@overlay/app-core'

export class NoOpObjectStore implements ObjectStore {
  async getUploadUrl(
    key: string,
    contentType: string,
    constraints?: import('@overlay/app-core').UploadConstraints,
  ): Promise<{ url: string; fields?: Record<string, string> }> {
    void key
    void contentType
    void constraints
    return { url: 'about:blank' }
  }

  async getDownloadUrl(key: string): Promise<string> {
    void key
    return 'about:blank'
  }

  async deleteObject(key: string): Promise<void> {
    void key
  }

  async listObjects(prefix: string): Promise<ObjectSummary[]> {
    void prefix
    return []
  }

  async downloadBuffer(): Promise<Uint8Array> {
    throw new Error('Object storage is disabled')
  }
}
