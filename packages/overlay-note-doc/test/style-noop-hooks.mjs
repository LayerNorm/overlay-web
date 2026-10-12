/** ESM loader hook: stub `.css` imports (katex ships a css import). */
export async function load(url, context, next) {
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      source: 'export default {}',
      shortCircuit: true,
    }
  }
  return next(url, context)
}
