export const HARNESS_DISPATCH_REQUIRED_MESSAGE = 'Asking other agents is not available in this run yet.'
export const HARNESS_DISPATCH_REQUIRED_CODE = 'harness_dispatch_required'

export const harnessDispatchRequiredOutput = {
  success: false,
  error: HARNESS_DISPATCH_REQUIRED_MESSAGE,
  code: HARNESS_DISPATCH_REQUIRED_CODE,
} as const
