export {
  applyAppDataCapabilitiesToOverlayCapabilities,
  CONVEX_APP_DATA_CAPABILITIES,
  deriveAppDataCapabilities,
  POSTGRES_PHASE5_APP_DATA_CAPABILITIES,
  selectedDatabaseProvider,
  type AppDataCapabilities,
  type AppDataProvider,
} from './capabilities'
export {
  UnsupportedAppDataRepositoryError,
  repositoryProxy,
  unsupportedRepository,
} from './errors'
export {
  PostgresBackgroundMaintenanceService,
  type PostgresBackgroundMaintenanceSummary,
} from './PostgresBackgroundMaintenanceService'
export {
  createAppDataContext,
  type AppDataContext,
  type AppDataRepositories,
} from './repositories'
export {
  appDataRouteUnsupportedResponse,
  findPostgresRouteRule,
  getAppDataRouteSupport,
  normalizeRoutePath,
  POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES,
  type AppDataRouteSupport,
  type AppDataRouteSupportRule,
  type AppDataRouteSupportStatus,
} from './route-support'
