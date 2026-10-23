import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const nextSpecifier = specifier === 'next/server' || specifier === 'next/headers'
      ? `${specifier}.js`
      : specifier
    return nextResolve(nextSpecifier, context)
  },
})
