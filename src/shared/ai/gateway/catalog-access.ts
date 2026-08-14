export function shouldLoadGatewayModelCatalog({
  isAuthenticated,
  isAuthLoading,
  isPublicShowcase,
}: {
  isAuthenticated: boolean
  isAuthLoading: boolean
  isPublicShowcase: boolean
}): boolean {
  return isAuthenticated && !isAuthLoading && !isPublicShowcase
}
