export function shouldLoadGatewayModelCatalog({
  isAuthenticated,
  isAuthLoading,

}: {
  isAuthenticated: boolean
  isAuthLoading: boolean

}): boolean {
  return isAuthenticated && !isAuthLoading
}
