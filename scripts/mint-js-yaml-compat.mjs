// Mintlify's transitive front-matter dependency still calls the js-yaml v3 API.
// Keep the patched js-yaml v4 dependency and provide the removed safe aliases only
// to the Mintlify subprocess until that dependency is updated upstream.
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)
const yaml = requireModule('js-yaml')

yaml.safeLoad = yaml.load
yaml.safeLoadAll = yaml.loadAll
yaml.safeDump = yaml.dump
