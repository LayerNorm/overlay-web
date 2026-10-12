/** ESM loader hook: stub `.css` imports (e.g. `@blocknote/math-block` ships `import 'katex/dist/katex.min.css'`). Pairs with register-style-noop.cjs, which only intercepts require(). */
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
