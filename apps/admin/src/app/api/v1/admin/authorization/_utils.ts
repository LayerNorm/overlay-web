// Re-export the app-level admin helpers under the names the copied
// authorization routes expect. The route bodies stay byte-identical to the
// web app's copies except for their import specifiers.
export {
  authorizationActor,
  authorizationAdminErrorResponse,
  authorizationAdministrationService,
  type AdminRouteContext,
} from '../_utils'
