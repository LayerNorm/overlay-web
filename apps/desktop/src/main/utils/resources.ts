import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * Get the path to a resource file.
 * Works in both development and production builds.
 */
export function getResourcePath(...paths: string[]): string {
  if (is.dev) {
    // In development, __dirname is out/main (after bundling), so go up 2 levels to project root
    return join(__dirname, '../../resources', ...paths)
  } else {
    // In production, resources are in extraResources
    return join(process.resourcesPath, 'resources', ...paths)
  }
}
