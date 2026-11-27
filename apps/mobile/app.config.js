module.exports = ({ config }) => {
  if (process.env.EAS_BUILD === 'true' && !process.env.EXPO_PUBLIC_CONVEX_URL?.trim()) {
    throw new Error('Set EXPO_PUBLIC_CONVEX_URL in the selected EAS environment before building.')
  }
  return config
}
